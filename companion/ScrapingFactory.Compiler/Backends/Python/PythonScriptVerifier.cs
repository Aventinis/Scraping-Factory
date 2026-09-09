using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Xml.Linq;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Proves a generated script actually works before it's handed to the user:
// writes it to a throwaway directory, runs it for real (network fetch,
// parsing, CSV export — everything), and checks it exited cleanly and
// produced at least one data row. This subsumes any static selector check —
// running the real script also catches network failures, encoding issues,
// and BeautifulSoup-vs-CSS-selector quirks a simulated check would miss.
public sealed class PythonScriptVerifier(string? pythonExecutable = null, TimeSpan? timeout = null) : IScriptVerifier
{
    // One shared timeout for every script this verifier runs, regardless of
    // which engine generated it: comfortably covers the Static engine's own
    // `requests.get(url, timeout=10)` plus interpreter/CSV overhead, and the
    // slower Browser engine (Chromium launch + page load + optional
    // WaitForStep). Avoids needing a per-engine verifier just for timing.
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(45);
    private static readonly string[] DefaultCandidates = ["python3", "python"];

    // Issue #122: how many rows/top-level XML elements a trial-run preview
    // ever carries, regardless of how much data the script actually
    // produced — a preview is a sanity check, not a full export, and this
    // keeps the /generate response small even for a script that legitimately
    // scrapes thousands of rows.
    private const int PreviewSampleCap = 50;

    private readonly TimeSpan _timeout = timeout ?? DefaultTimeout;
    private readonly string[] _candidates = pythonExecutable is not null ? [pythonExecutable] : DefaultCandidates;

    public string LanguageId => "python";

    public async Task<ScriptVerificationResult> VerifyAsync(
        string script, OutputFormat outputFormat = OutputFormat.Csv, string outputFileBaseName = "output",
        TimeSpan extraTimeout = default, IReadOnlyDictionary<string, string>? extraEnvironmentVariables = null,
        bool includePreview = false, CancellationToken ct = default)
    {
        var effectiveTimeout = _timeout + extraTimeout;
        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-verify-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script, ct);

            var (process, executableUsed) = StartProcess(scriptPath, workDir, extraEnvironmentVariables);
            if (process is null)
            {
                return new ScriptVerificationResult
                {
                    Success = false,
                    Error = $"No Python interpreter found (tried: {string.Join(", ", _candidates)}). " +
                            "Is Python installed and available on the companion app's PATH?",
                };
            }

            using (process)
            {
                var stderrBuilder = new StringBuilder();
                process.ErrorDataReceived += (_, e) => { if (e.Data is not null) stderrBuilder.AppendLine(e.Data); };
                process.BeginErrorReadLine();
                var stdoutTask = process.StandardOutput.ReadToEndAsync(ct);

                using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeoutCts.CancelAfter(effectiveTimeout);
                try
                {
                    await process.WaitForExitAsync(timeoutCts.Token);
                }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                {
                    TryKill(process);
                    return new ScriptVerificationResult
                    {
                        Success = false,
                        Error = $"Script execution exceeded the {effectiveTimeout.TotalSeconds:0}s timeout.",
                    };
                }
                await stdoutTask;

                if (process.ExitCode != 0)
                {
                    return new ScriptVerificationResult
                    {
                        Success = false,
                        Error = $"Script ({executableUsed}) exited with an error (exit code {process.ExitCode}): " +
                                Truncate(stderrBuilder.ToString()),
                    };
                }
            }

            if (outputFormat == OutputFormat.Xml)
                return VerifyXmlOutput(workDir, outputFileBaseName, includePreview);

            if (outputFormat == OutputFormat.Json)
                return VerifyJsonOutput(workDir, outputFileBaseName, includePreview);

            var csvFileName = $"{outputFileBaseName}.csv";
            var csvPath = Path.Combine(workDir, csvFileName);
            if (!File.Exists(csvPath))
            {
                return new ScriptVerificationResult { Success = false, Error = $"Script did not produce {csvFileName}." };
            }

            var lines = await File.ReadAllLinesAsync(csvPath, ct);
            var rowCount = Math.Max(0, lines.Length - 1); // minus header row

            // Also covers API-Mode's 0-combinations edge case (a
            // DiscoverySource resolving to no values at runtime, despite
            // ScrapingPlanValidator requiring at least one parameter with a
            // non-empty static list/range at config time) — treated
            // identically to any other 0-row result, not a special case.
            if (rowCount == 0)
            {
                return new ScriptVerificationResult
                {
                    Success = false,
                    Error = "Script ran without errors but returned no data " +
                            $"({csvFileName} contains only the header row) — at least one selector or request likely found nothing.",
                };
            }

            return new ScriptVerificationResult
            {
                Success = true, RowCount = rowCount,
                Preview = includePreview ? BuildCsvPreview(lines, rowCount) : null,
            };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return new ScriptVerificationResult { Success = false, Error = $"Verification failed: {ex.Message}" };
        }
        finally
        {
            try { Directory.Delete(workDir, recursive: true); } catch { /* best-effort cleanup */ }
        }
    }

    // XML analog of the CSV "at least one data row" check above: output.xml
    // must exist, parse as valid XML, and its root must have at least one
    // descendant element. Parse failures (e.g. an invalid XML tag name from
    // a Container-Mode Name the user typed) bubble up to VerifyAsync's outer
    // catch, same as any other unexpected exception during verification.
    private static ScriptVerificationResult VerifyXmlOutput(string workDir, string outputFileBaseName, bool includePreview)
    {
        var xmlFileName = $"{outputFileBaseName}.xml";
        var xmlPath = Path.Combine(workDir, xmlFileName);
        if (!File.Exists(xmlPath))
            return new ScriptVerificationResult { Success = false, Error = $"Script did not produce {xmlFileName}." };

        var document = XDocument.Load(xmlPath);
        var elementCount = document.Root?.Descendants().Count() ?? 0;

        if (elementCount == 0)
        {
            return new ScriptVerificationResult
            {
                Success = false,
                Error = "Script ran without errors but returned no data " +
                        $"({xmlFileName} contains no elements) — at least one selector likely found nothing.",
            };
        }

        return new ScriptVerificationResult
        {
            Success = true, RowCount = elementCount,
            Preview = includePreview ? BuildXmlPreview(document, elementCount) : null,
        };
    }

    // Json analog of the CSV/XML "at least one data row" checks above
    // (Issue #86): output.json must exist and parse as valid JSON. Json is
    // used for two structurally different shapes — a flat array of records
    // (Fields/API-flat, the Csv analog) or a nested object mirroring the
    // group/API tree (Groups/API-tree, the Xml analog) — which of the two
    // it is self-describes via the root's JsonNode type, so (unlike Csv vs.
    // Xml) no separate code path needs to be selected by the caller.
    private static ScriptVerificationResult VerifyJsonOutput(string workDir, string outputFileBaseName, bool includePreview)
    {
        var jsonFileName = $"{outputFileBaseName}.json";
        var jsonPath = Path.Combine(workDir, jsonFileName);
        if (!File.Exists(jsonPath))
            return new ScriptVerificationResult { Success = false, Error = $"Script did not produce {jsonFileName}." };

        var root = JsonNode.Parse(File.ReadAllText(jsonPath));

        if (root is JsonArray array)
        {
            if (array.Count == 0)
            {
                return new ScriptVerificationResult
                {
                    Success = false,
                    Error = "Script ran without errors but returned no data " +
                            $"({jsonFileName} contains no records) — at least one selector or request likely found nothing.",
                };
            }

            return new ScriptVerificationResult
            {
                Success = true, RowCount = array.Count,
                Preview = includePreview ? BuildJsonFlatPreview(array) : null,
            };
        }

        // Same "at least one" role as XDocument's Descendants().Count() for
        // Xml, but not numerically equivalent to it: counts every object
        // property and array item recursively (excluding the root itself),
        // which — unlike an XML element per tag — folds a leaf field
        // straight into its parent's dict, so a JSON tree's count for the
        // same data will generally differ from the XML count. Only the
        // "greater than zero" outcome is actually load-bearing.
        var elementCount = CountJsonNodes(root);
        if (elementCount == 0)
        {
            return new ScriptVerificationResult
            {
                Success = false,
                Error = "Script ran without errors but returned no data " +
                        $"({jsonFileName} contains no elements) — at least one selector likely found nothing.",
            };
        }

        return new ScriptVerificationResult
        {
            Success = true, RowCount = elementCount,
            Preview = includePreview ? BuildJsonTreePreview(root!, elementCount) : null,
        };
    }

    private static int CountJsonNodes(JsonNode? node) => node switch
    {
        JsonObject obj => obj.Sum(property => 1 + CountJsonNodes(property.Value)),
        JsonArray arr => arr.Sum(item => 1 + CountJsonNodes(item)),
        _ => 0,
    };

    // Json preview, flat shape: an array of uniform record objects — the
    // same Columns/Rows table BuildCsvPreview already produces, just read
    // from JsonNode instead of a raw CSV line. Every value the generator's
    // own templates ever write here is a plain string (record values,
    // parameter columns alike), so GetValue<string>() is safe.
    private static ScriptPreviewData BuildJsonFlatPreview(JsonArray array)
    {
        var sampleRecords = array.Take(PreviewSampleCap).OfType<JsonObject>().ToList();
        var columns = sampleRecords.Count > 0 ? sampleRecords[0].Select(property => property.Key).ToList() : [];
        var rows = sampleRecords
            .Select(record =>
            {
                var row = new Dictionary<string, string>();
                foreach (var column in columns)
                    row[column] = record[column]?.GetValue<string>() ?? "";
                return (IReadOnlyDictionary<string, string>)row;
            })
            .ToList();

        return new ScriptPreviewData
        {
            OutputFormat = "Json",
            TotalCount = array.Count,
            Truncated = array.Count > PreviewSampleCap,
            Columns = columns,
            Rows = rows,
        };
    }

    // Json preview, tree shape: mirrors BuildXmlPreview's own "cap only the
    // top-level repeating structure, not the whole tree" approach — a
    // top-level property whose value is an array (a repeating root group,
    // or several same-named root-level matches) is capped at
    // PreviewSampleCap items; any other top-level property is left as-is.
    // Re-parses instead of mutating the caller's own root (JsonArray.RemoveAt
    // needs an already-owned array to mutate in place).
    private static ScriptPreviewData BuildJsonTreePreview(JsonNode root, int elementCount)
    {
        var truncated = false;
        var sample = JsonNode.Parse(root.ToJsonString())!;
        if (sample is JsonObject obj)
        {
            foreach (var key in obj.Select(property => property.Key).ToList())
            {
                if (obj[key] is not JsonArray propertyArray || propertyArray.Count <= PreviewSampleCap)
                    continue;
                truncated = true;
                while (propertyArray.Count > PreviewSampleCap)
                    propertyArray.RemoveAt(propertyArray.Count - 1);
            }
        }

        return new ScriptPreviewData
        {
            OutputFormat = "Json",
            TotalCount = elementCount,
            Truncated = truncated,
            JsonSample = sample.ToJsonString(new JsonSerializerOptions { WriteIndented = true }),
        };
    }

    // Csv preview: re-parses the header/data lines VerifyAsync already read
    // for the row count above — no extra file I/O. Field-level parsing is
    // needed here (unlike the row-count check, which only counts lines)
    // since a quoted field can itself contain a comma (see ParseCsvLine).
    private static ScriptPreviewData BuildCsvPreview(string[] lines, int rowCount)
    {
        var columns = ParseCsvLine(lines[0]);
        var sampleRows = lines.Skip(1).Take(PreviewSampleCap)
            .Select(line =>
            {
                var values = ParseCsvLine(line);
                var row = new Dictionary<string, string>();
                for (var i = 0; i < columns.Count; i++)
                    row[columns[i]] = i < values.Count ? values[i] : "";
                return (IReadOnlyDictionary<string, string>)row;
            })
            .ToList();

        return new ScriptPreviewData
        {
            OutputFormat = "Csv",
            TotalCount = rowCount,
            Truncated = rowCount > PreviewSampleCap,
            Columns = columns,
            Rows = sampleRows,
        };
    }

    // Xml preview (Phase A — see PLAN-trial-run-data-preview.md): a
    // pretty-printed fragment containing only the first PreviewSampleCap
    // top-level elements, reusing the XDocument VerifyXmlOutput already
    // parsed for the element-count check above. "Truncated" compares
    // top-level elements (what was actually capped here) rather than
    // elementCount (every descendant at every nesting level, the metric
    // RowCount/TotalCount mirrors) — the two only coincide for a flat,
    // one-level tree.
    private static ScriptPreviewData BuildXmlPreview(XDocument document, int elementCount)
    {
        var rootElements = document.Root!.Elements().ToList();
        var sampleDocument = new XDocument(new XElement(document.Root.Name, rootElements.Take(PreviewSampleCap)));

        return new ScriptPreviewData
        {
            OutputFormat = "Xml",
            TotalCount = elementCount,
            Truncated = rootElements.Count > PreviewSampleCap,
            XmlSample = sampleDocument.ToString(),
        };
    }

    // Splits one CSV line into its fields, matching Python's csv.DictWriter
    // default ("excel") dialect the code generator always writes with:
    // comma-separated, "..."-quoted fields may themselves contain commas/
    // newlines, "" inside a quoted field is an escaped literal quote. Only
    // used to build a human-readable preview sample — the row-count check
    // above never needs field-level parsing, only line counting.
    private static List<string> ParseCsvLine(string line)
    {
        var fields = new List<string>();
        var current = new StringBuilder();
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

    private (Process? Process, string? Executable) StartProcess(
        string scriptPath, string workDir, IReadOnlyDictionary<string, string>? extraEnv)
    {
        foreach (var candidate in _candidates)
        {
            var psi = new ProcessStartInfo
            {
                FileName = candidate,
                WorkingDirectory = workDir,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add(scriptPath);
            if (extraEnv is not null)
            {
                foreach (var (key, value) in extraEnv)
                    psi.Environment[key] = value;
            }

            try
            {
                var process = new Process { StartInfo = psi };
                process.Start();
                return (process, candidate);
            }
            catch (Win32Exception)
            {
                // Executable not found on PATH — try the next candidate.
            }
        }
        return (null, null);
    }

    private static void TryKill(Process process)
    {
        try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch { /* best-effort */ }
    }

    private static string Truncate(string text, int max = 2000)
    {
        var trimmed = text.Trim();
        return trimmed.Length <= max ? trimmed : trimmed[..max] + "… (truncated)";
    }
}
