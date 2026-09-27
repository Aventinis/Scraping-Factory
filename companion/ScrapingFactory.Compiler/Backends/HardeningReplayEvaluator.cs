using System.Text.Json;
using System.Xml.Linq;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends;

// Issue #207: a companion-side "replay" of script hardening (#129-#133)
// against an already-saved output (Issue #202) instead of a live script run
// — a popup-driven, on-demand analysis/tuning aid only. Deliberately mirrors
// the Python templates' own runtime logic (_run_hardening_checks/
// _passes_required_fields in scraper.py.j2/scraper_grouped.py.j2) rather
// than reimplementing it independently, per the issue's own explicit "the
// central design risk here is avoiding divergence from the templates' own
// logic" framing — read those two functions again before changing anything
// here, they're the source of truth this class must keep matching.
//
// Never touches the generated .py script or any of its templates — this is
// a second, independent evaluation path over already-materialized data
// (a parsed CSV/XML/JSON string), not a new runtime behavior.
public enum HardeningReplayOutcome { Passed, Triggered, Inconclusive, NotEvaluable }

public sealed record HardeningReplayCheckResult(string Kind, HardeningSeverity Severity, HardeningReplayOutcome Outcome, string Message);

public static class HardeningReplayEvaluator
{
    // previousResultCount/previousUnavailableReason are resolved by the
    // caller (Program.cs's new endpoint, which has database access this pure
    // evaluator deliberately doesn't) — only actually consulted when a
    // BaselineCheck is among `checks`. previousUnavailableReason explains an
    // absent previousResultCount specifically (no Blueprint set on this
    // configuration, or no earlier saved output exists yet), surfaced
    // verbatim in that check's own Inconclusive message instead of a generic
    // "no baseline" line.
    public static IReadOnlyList<HardeningReplayCheckResult> Evaluate(
        IReadOnlyList<HardeningCheck> checks, string fileName, string content,
        int? previousResultCount, string? previousUnavailableReason)
    {
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
        // Issue #132: BlockingCheck evaluates the raw HTTP response (final
        // URL host, body length, body text) captured at request time — never
        // persisted anywhere a saved output could replay it from.
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

    // Mirrors the runtime's own "missing key defaults to empty" semantics
    // exactly once the field is confirmed to exist in this dataset at all —
    // but a field name that doesn't appear in the saved output's own
    // columns/tags anywhere (a stale/typo'd/renamed field, or one dropped by
    // an Output Blueprint mapping/ExternalConfig rename at save time — see
    // CLAUDE.md's own documented v1 limitation on this) is reported as
    // Inconclusive rather than mechanically computing a misleading 100%
    // empty rate.
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

    // Issue #133's own live runtime *filters* rows/instances before writing
    // — a saved output already reflects that filtering, so replaying this
    // check can only ever be a diagnostic re-scan of whatever's actually
    // present now ("would this many rows/instances currently be flagged"),
    // not a reproduction of the original run's own drop count. Still useful
    // for testing a field name not required at save time, or a file saved
    // before this check existed at all.
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

    // Only ever needs the top-level result count for Baseline comparison —
    // exposed separately so Program.cs can parse a *previous* saved output
    // just far enough to get its own ResultCount, without needing a second,
    // ad-hoc parsing code path.
    public static int GetResultCount(string fileName, string content) => ParsedDataset.Parse(fileName, content).ResultCount;

    // Flat (CSV/JSON) rows are a list of string-keyed dicts, matching the
    // runtime's own `data`; a tree (XML) output is matched by tag name
    // anywhere in the document, matching the runtime's own `root.iter(name)`/
    // `root.findall(".//*")` (see scraper_grouped.py.j2's _run_hardening_checks).
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

    // knownFields is tracked separately from the row list itself (the CSV
    // header, or the union of every row's own JSON keys) specifically so
    // FieldExists still correctly recognizes a genuinely configured field
    // even when there are zero data rows at all — the exact "no data was
    // extracted" case NoResultCheck itself exists to catch, where relying on
    // rows.Any(...) alone would otherwise report every other check's field
    // as "not present" (a misleading message, even though the Inconclusive
    // outcome it'd produce either way happens to still be correct).
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

        // Same "excel" CSV dialect (comma-separated, "..."-quoted fields may
        // contain commas/newlines, "" is an escaped literal quote) as
        // PythonScriptVerifier's own ParseCsvLine, which every generated
        // script's csv.DictWriter always writes with — deliberately a
        // separate copy rather than a shared reference across the two
        // classes' otherwise-unrelated responsibilities (verification vs.
        // replay), the same small-helper-duplication convention this
        // codebase already accepts elsewhere (e.g. sanitizeFileNameBase vs.
        // FileNameSanitizer).
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

        // Unlike CSV, a JSON array carries no header — knownFields here can
        // only ever be the union of whatever rows actually exist, so (unlike
        // CSV) a genuinely empty [] can never distinguish "field not
        // present" from "no rows at all" for FieldExists' own message; the
        // Inconclusive outcome itself is still correct either way, just the
        // wording is a documented, JSON-specific limitation.
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

    // Issue #133 follow-up (container mode): "instance" here means each
    // direct child of the document root — the common shape for a single
    // (or multiple, combined-under-<Ergebnis>) repeating group. A required
    // field nested inside a *deeper* repeating group only ever drops that
    // inner instance at runtime, not its outer container — this replay
    // evaluator doesn't have the original group-tree schema to reproduce
    // that nesting-aware drop precisely against an already-serialized file,
    // so CountMissingAnyRequiredField is a documented, coarser approximation
    // (top-level instances only) rather than the runtime's own exact
    // nearest-enclosing-instance behavior.
    private sealed class TreeDataset(XElement root) : ParsedDataset
    {
        public override int ResultCount => root.Descendants().Count();

        public override bool FieldExists(string fieldName) => root.Descendants(fieldName).Any();

        public override IEnumerable<string> ValuesFor(string fieldName) =>
            root.Descendants(fieldName).Select(el => el.Value ?? "");

        // Mirrors _passes_required_fields' own per-instance logic exactly: a
        // required field with ZERO matches inside an instance is a silent
        // no-op there (not a failure) — only a match that's PRESENT but
        // empty fails that instance. (This replay tool's own EvaluateRequiredFields
        // still reports a field entirely absent from the whole dataset as
        // Inconclusive up front, deliberately more conservative than the
        // live runtime's own per-instance silent-no-op — see that method's
        // own doc comment.)
        public override int CountMissingAnyRequiredField(IReadOnlyList<string> fieldNames) =>
            root.Elements().Count(instance => fieldNames.Any(name => instance.Descendants(name).Any(el => string.IsNullOrWhiteSpace(el.Value))));
    }
}
