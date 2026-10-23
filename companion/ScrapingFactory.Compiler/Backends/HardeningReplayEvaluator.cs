using System.Text.Json;
using System.Xml.Linq;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends;

// Replays the hardening checks against an already-saved output (CSV/JSON/XML) instead of a live run, as an
// on-demand tuning aid. It mirrors the templates' _run_hardening_checks / _passes_required_fields: read those
// before changing anything here, they are the source of truth. Never touches the generated script.
public enum HardeningReplayOutcome { Passed, Triggered, Inconclusive, NotEvaluable }

public sealed record HardeningReplayCheckResult(string Kind, HardeningSeverity Severity, HardeningReplayOutcome Outcome, string Message);

public static class HardeningReplayEvaluator
{
    // previousResultCount / previousUnavailableReason are resolved by the caller (it has the database); they are only
    // used for a BaselineCheck, and the reason explains an absent count in that check's message.
    public static IReadOnlyList<HardeningReplayCheckResult> Evaluate(
        IReadOnlyList<HardeningCheck> checks, string fileName, string content,
        int? previousResultCount, string? previousUnavailableReason)
    {
        // Saved SQLite/Excel outputs are binary (base64 text): nothing can be evaluated.
        if (!IsReplayable(fileName))
        {
            return checks.Select(check => new HardeningReplayCheckResult(
                check.GetType().Name switch
                {
                    nameof(NoResultCheck) => "noResult", nameof(NullRateCheck) => "nullRate", nameof(RequiredFieldsCheck) => "requiredFields",
                    nameof(BaselineCheck) => "baseline", nameof(BlockingCheck) => "blocking", _ => "unknown",
                },
                check.Severity, HardeningReplayOutcome.NotEvaluable,
                "Saved SQLite/Excel outputs can't be replayed — only CSV, JSON and XML outputs can.")).ToList();
        }

        var dataset = ParsedDataset.Parse(fileName, content);
        var results = new List<HardeningReplayCheckResult>();
        foreach (var check in checks)
            results.Add(EvaluateCheck(check, dataset, previousResultCount, previousUnavailableReason));
        return results;
    }

    private static HardeningReplayCheckResult EvaluateCheck(
        HardeningCheck check, ParsedDataset dataset, int? previousResultCount, string? previousUnavailableReason) => check switch
    {
        NoResultCheck => EvaluateNoResult(check, dataset),
        NullRateCheck nullRate => EvaluateNullRate(nullRate, dataset),
        RequiredFieldsCheck requiredFields => EvaluateRequiredFields(requiredFields, dataset),
        BaselineCheck baseline => EvaluateBaseline(baseline, dataset, previousResultCount, previousUnavailableReason),
        // Needs the raw HTTP response, which a saved output does not contain.
        BlockingCheck => new HardeningReplayCheckResult(
            "blocking", check.Severity, HardeningReplayOutcome.NotEvaluable,
            "Blocking detection needs the raw response captured during scraping, which isn't part of a saved output — this check can't be replayed."),
        _ => throw new InvalidOperationException($"Unknown HardeningCheck type: {check.GetType()}"),
    };

    private static HardeningReplayCheckResult EvaluateNoResult(HardeningCheck check, ParsedDataset dataset)
    {
        var count = dataset.ResultCount;
        if (count > 0)
            return new HardeningReplayCheckResult("noResult", check.Severity, HardeningReplayOutcome.Passed, $"{count} row(s)/element(s) found.");
        return new HardeningReplayCheckResult(
            "noResult", check.Severity, HardeningReplayOutcome.Triggered,
            "No data was extracted — at least one selector likely matched nothing.");
    }

    // A field that appears nowhere in the saved output (typo, renamed, dropped by a blueprint) is Inconclusive
    // rather than a misleading 100% empty rate.
    private static HardeningReplayCheckResult EvaluateNullRate(NullRateCheck check, ParsedDataset dataset)
    {
        if (!dataset.FieldExists(check.FieldName))
        {
            return new HardeningReplayCheckResult(
                "nullRate", check.Severity, HardeningReplayOutcome.Inconclusive,
                $"Field '{check.FieldName}' isn't present in this saved output — nothing to evaluate.");
        }

        var values = dataset.ValuesFor(check.FieldName).ToList();
        var total = dataset.ResultCount;
        if (total == 0)
        {
            return new HardeningReplayCheckResult(
                "nullRate", check.Severity, HardeningReplayOutcome.Inconclusive, "This saved output has no rows/elements to evaluate.");
        }
        var empty = values.Count(v => string.IsNullOrWhiteSpace(v));
        var rate = (double)empty / total;
        if (rate > check.Threshold)
        {
            return new HardeningReplayCheckResult(
                "nullRate", check.Severity, HardeningReplayOutcome.Triggered,
                $"Field '{check.FieldName}': {rate:P0} of rows are empty (threshold: {check.Threshold:P0}).");
        }
        return new HardeningReplayCheckResult(
            "nullRate", check.Severity, HardeningReplayOutcome.Passed,
            $"Field '{check.FieldName}': {rate:P0} of rows are empty (threshold: {check.Threshold:P0}).");
    }

    // The live run filters before writing, so a saved output is already filtered: this is a diagnostic re-scan
    // ("how many would be flagged now"), not a reproduction of the original drop count.
    private static HardeningReplayCheckResult EvaluateRequiredFields(RequiredFieldsCheck check, ParsedDataset dataset)
    {
        var missingFields = check.FieldNames.Where(name => !dataset.FieldExists(name)).ToList();
        if (missingFields.Count > 0)
        {
            return new HardeningReplayCheckResult(
                "requiredFields", check.Severity, HardeningReplayOutcome.Inconclusive,
                $"Field(s) not present in this saved output: {string.Join(", ", missingFields)} — nothing to evaluate.");
        }

        var droppedCount = dataset.CountMissingAnyRequiredField(check.FieldNames);
        if (droppedCount > 0)
        {
            return new HardeningReplayCheckResult(
                "requiredFields", check.Severity, HardeningReplayOutcome.Triggered,
                $"{droppedCount} row(s)/element(s) in this saved output are missing a required field.");
        }
        return new HardeningReplayCheckResult(
            "requiredFields", check.Severity, HardeningReplayOutcome.Passed,
            "Every row/element in this saved output has all required fields.");
    }

    private static HardeningReplayCheckResult EvaluateBaseline(
        BaselineCheck check, ParsedDataset dataset, int? previousResultCount, string? previousUnavailableReason)
    {
        if (previousResultCount is not { } baseline || baseline == 0)
        {
            return new HardeningReplayCheckResult(
                "baseline", check.Severity, HardeningReplayOutcome.Inconclusive,
                previousUnavailableReason ?? "No earlier saved output is available to compare against.");
        }

        var count = dataset.ResultCount;
        var drop = (double)(baseline - count) / baseline;
        if (drop > check.DropThreshold)
        {
            return new HardeningReplayCheckResult(
                "baseline", check.Severity, HardeningReplayOutcome.Triggered,
                $"Result count dropped from {baseline} to {count} (more than the {check.DropThreshold:P0} threshold).");
        }
        return new HardeningReplayCheckResult(
            "baseline", check.Severity, HardeningReplayOutcome.Passed,
            $"Result count is {count} (previous: {baseline}).");
    }

    // Lets ConfigEndpoints parse a previous saved output just far enough to get its ResultCount. CSV/JSON/XML only.
    public static bool IsReplayable(string fileName) =>
        Path.GetExtension(fileName).TrimStart('.').ToLowerInvariant() is "csv" or "json" or "xml";

    public static int GetResultCount(string fileName, string content) => ParsedDataset.Parse(fileName, content).ResultCount;

    // Flat (CSV/JSON) rows are string-keyed dicts like the runtime's `data`; a tree (XML) is matched by tag name
    // anywhere, like the runtime's `root.iter(name)` and `root.findall(".//*")`.
    private abstract class ParsedDataset
    {
        public abstract int ResultCount { get; }
        public abstract bool FieldExists(string fieldName);
        public abstract IEnumerable<string> ValuesFor(string fieldName);
        public abstract int CountMissingAnyRequiredField(IReadOnlyList<string> fieldNames);

        public static ParsedDataset Parse(string fileName, string content)
        {
            var extension = Path.GetExtension(fileName).TrimStart('.').ToLowerInvariant();
            return extension switch
            {
                "csv" => FlatDataset.FromCsv(content),
                "json" => FlatDataset.FromJson(content),
                "xml" => new TreeDataset(XElement.Parse(content)),
                _ => throw new NotSupportedException($"Unsupported saved-output file extension '.{extension}' for hardening replay."),
            };
        }
    }

    // knownFields (the CSV header, or the union of the JSON rows' keys) is kept apart from the rows so a configured
    // field is still recognized when there are no rows at all.
    private sealed class FlatDataset(List<Dictionary<string, string>> rows, IReadOnlyCollection<string> knownFields) : ParsedDataset
    {
        public override int ResultCount => rows.Count;

        public override bool FieldExists(string fieldName) => knownFields.Contains(fieldName);

        public override IEnumerable<string> ValuesFor(string fieldName) =>
            rows.Select(row => row.GetValueOrDefault(fieldName, ""));

        public override int CountMissingAnyRequiredField(IReadOnlyList<string> fieldNames) =>
            rows.Count(row => fieldNames.Any(name => string.IsNullOrWhiteSpace(row.GetValueOrDefault(name, ""))));

        public static FlatDataset FromCsv(string content)
        {
            var lines = content.Replace("\r\n", "\n").Split('\n').Where(line => line.Length > 0).ToList();
            if (lines.Count == 0) return new FlatDataset([], []);

            var columns = ParseCsvLine(lines[0]);
            var rows = lines.Skip(1).Select(line =>
            {
                var values = ParseCsvLine(line);
                var row = new Dictionary<string, string>();
                for (var i = 0; i < columns.Count; i++)
                    row[columns[i]] = i < values.Count ? values[i] : "";
                return row;
            }).ToList();
            return new FlatDataset(rows, columns);
        }

        // The "excel" CSV dialect csv.DictWriter writes (same as PythonScriptVerifier.ParseCsvLine; a separate copy
        // because the two classes are otherwise unrelated).
        private static List<string> ParseCsvLine(string line)
        {
            var fields = new List<string>();
            var current = new System.Text.StringBuilder();
            var inQuotes = false;
            for (var i = 0; i < line.Length; i++)
            {
                var c = line[i];
                if (inQuotes)
                {
                    if (c != '"') { current.Append(c); continue; }
                    if (i + 1 < line.Length && line[i + 1] == '"') { current.Append('"'); i++; }
                    else inQuotes = false;
                    continue;
                }
                switch (c)
                {
                    case '"': inQuotes = true; break;
                    case ',': fields.Add(current.ToString()); current.Clear(); break;
                    default: current.Append(c); break;
                }
            }
            fields.Add(current.ToString());
            return fields;
        }

        // A JSON array has no header, so an empty [] cannot tell "field absent" from "no rows" (outcome still correct).
        public static FlatDataset FromJson(string content)
        {
            using var document = JsonDocument.Parse(content);
            var rows = document.RootElement.EnumerateArray().Select(rowElement =>
            {
                var row = new Dictionary<string, string>();
                foreach (var property in rowElement.EnumerateObject())
                    row[property.Name] = JsonValueToString(property.Value);
                return row;
            }).ToList();
            var knownFields = rows.SelectMany(row => row.Keys).Distinct().ToList();
            return new FlatDataset(rows, knownFields);
        }

        private static string JsonValueToString(JsonElement value) => value.ValueKind switch
        {
            JsonValueKind.String => value.GetString() ?? "",
            JsonValueKind.Null => "",
            JsonValueKind.True => "True",
            JsonValueKind.False => "False",
            _ => value.GetRawText(),
        };
    }

    // An "instance" is a direct child of the document root. The runtime drops the nearest enclosing repeating
    // instance at any depth; a saved file has no schema to reproduce that, so this is a coarser approximation.
    private sealed class TreeDataset(XElement root) : ParsedDataset
    {
        public override int ResultCount => root.Descendants().Count();

        public override bool FieldExists(string fieldName) => root.Descendants(fieldName).Any();

        public override IEnumerable<string> ValuesFor(string fieldName) =>
            root.Descendants(fieldName).Select(el => el.Value ?? "");

        // Like _passes_required_fields: a required field with zero matches in an instance is a no-op; only a
        // present but empty match fails it.
        public override int CountMissingAnyRequiredField(IReadOnlyList<string> fieldNames) =>
            root.Elements().Count(instance => fieldNames.Any(name => instance.Descendants(name).Any(el => string.IsNullOrWhiteSpace(el.Value))));
    }
}
