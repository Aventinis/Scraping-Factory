using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Proves a generated script works before it is handed out: writes it to a throwaway directory, runs it for real
// and checks it exited cleanly with at least one data row. Running the real script also catches network, encoding
// and selector-compatibility problems a simulated check would miss.
public sealed class PythonScriptVerifier(string? pythonExecutable = null, TimeSpan? timeout = null) : IScriptVerifier
{
    // One timeout for every engine: enough for a requests fetch and for a Chromium launch plus page load.
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(45);
    private static readonly string[] DefaultCandidates = ["python3", "python"];

    // EXIT_MISSING_ENV_VAR in the templates: a missing credential or proxy variable. Compatible with success, since
    // the proxy case still produces data; the "did it produce data" check decides.
    private const int MissingEnvVarExitCode = 78;

    // EXIT_HARDENING_FAILED in the templates, emitted after the output was written, so the "did it produce data"
    // check decides here as well.
    private const int HardeningFailedExitCode = 2;

    // Rows / top-level elements a preview carries: a sanity check, not an export.
    private const int PreviewSampleCap = 50;

    private readonly TimeSpan _timeout = timeout ?? DefaultTimeout;
    private readonly string[] _candidates = pythonExecutable is not null ? [pythonExecutable] : DefaultCandidates;

    public string LanguageId => "python";

    public async Task<ScriptVerificationResult> VerifyAsync(
        string script, OutputFormat outputFormat = OutputFormat.Csv, string outputFileBaseName = "output",
        TimeSpan extraTimeout = default, IReadOnlyDictionary<string, string>? extraEnvironmentVariables = null,
        bool includePreview = false, bool includeOutputFile = false, CancellationToken ct = default)
    {
        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-verify-").FullName;
        try
        {
            var run = await RunScriptAsync(script, workDir, extraTimeout, extraEnvironmentVariables, ct);
            if (!run.RanCleanly)
                return new ScriptVerificationResult { Success = false, Error = run.Error };

            // A FillStep with a missing credential exits before writing anything: surface its own clean message. The
            // proxy case still writes output, so it only short-circuits when there is nothing to verify.
            if (run.ExitCode == MissingEnvVarExitCode &&
                !File.Exists(Path.Combine(workDir, ExpectedFileName(outputFormat, outputFileBaseName))))
            {
                return new ScriptVerificationResult { Success = false, Error = Truncate(run.Stderr) };
            }

            return outputFormat switch
            {
                OutputFormat.Xml => VerifyXmlOutput(workDir, outputFileBaseName, includePreview, includeOutputFile),
                OutputFormat.Json => VerifyJsonOutput(workDir, outputFileBaseName, includePreview, includeOutputFile),
                OutputFormat.Sqlite or OutputFormat.Xlsx => await VerifyTabularOutputAsync(workDir, outputFormat, outputFileBaseName, includePreview, includeOutputFile, ct),
                _ => await VerifyCsvOutput(workDir, outputFileBaseName, includePreview, includeOutputFile, ct),
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

    // One run, then every block's output file is checked; one failing block fails the whole call, prefixed with
    // its name.
    public async Task<ScriptVerificationResult> VerifyBlocksAsync(
        string script, IReadOnlyList<BlockOutputSpec> blocks,
        TimeSpan extraTimeout = default, IReadOnlyDictionary<string, string>? extraEnvironmentVariables = null,
        bool includePreview = false, bool includeOutputFile = false, CancellationToken ct = default)
    {
        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-verify-").FullName;
        try
        {
            var run = await RunScriptAsync(script, workDir, extraTimeout, extraEnvironmentVariables, ct);
            if (!run.RanCleanly)
                return new ScriptVerificationResult { Success = false, Error = run.Error };

            // Same reasoning as VerifyAsync's own MissingEnvVarExitCode
            // short-circuit, generalized to "not even one block produced a
            // file" — a FillStep failing before extraction ever starts
            // means every block is equally affected, not just one.
            if (run.ExitCode == MissingEnvVarExitCode &&
                !blocks.Any(block => File.Exists(Path.Combine(workDir, ExpectedFileName(block.OutputFormat, block.OutputFileBaseName)))))
            {
                return new ScriptVerificationResult { Success = false, Error = Truncate(run.Stderr) };
            }

            var blockResults = new List<BlockVerificationResult>();
            foreach (var block in blocks)
            {
                var single = block.OutputFormat switch
                {
                    OutputFormat.Xml => VerifyXmlOutput(workDir, block.OutputFileBaseName, includePreview, includeOutputFile),
                    OutputFormat.Json => VerifyJsonOutput(workDir, block.OutputFileBaseName, includePreview, includeOutputFile),
                    _ => await VerifyCsvOutput(workDir, block.OutputFileBaseName, includePreview, includeOutputFile, ct),
                };
                if (!single.Success)
                    return new ScriptVerificationResult { Success = false, Error = $"Block '{block.Name}': {single.Error}" };

                blockResults.Add(new BlockVerificationResult
                {
                    Name = block.Name, RowCount = single.RowCount, Preview = single.Preview,
                    OutputFileContent = single.OutputFileContent, OutputFileName = single.OutputFileName,
                });
            }

            return new ScriptVerificationResult { Success = true, Blocks = blockResults };
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

    private static string ExpectedFileName(OutputFormat format, string baseName) => format switch
    {
        OutputFormat.Xml => $"{baseName}.xml",
        OutputFormat.Json => $"{baseName}.json",
        OutputFormat.Sqlite => $"{baseName}.sqlite",
        OutputFormat.Xlsx => $"{baseName}.xlsx",
        _ => $"{baseName}.csv",
    };

    // The exact lines the templates print before a pause (_pace_request) or a retry (_send_with_retry); see RunScriptAsync.
    private static readonly Regex PauseAnnouncementPattern = new(@"^Pausing (\d+(?:\.\d+)?) s before the next request \(request delay\)");
    private static readonly Regex RetryAnnouncementPattern = new(@"^Retrying in (\d+(?:\.\d+)?) s \(attempt \d+ of \d+\)");

    // Granted per announced retry on top of its wait: the retried request itself may take up to its own timeout.
    private static readonly TimeSpan RetryAttemptAllowance = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan MaxRequestDelayExtension = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(200);

    // Shared by VerifyAsync / VerifyBlocksAsync: writes the script, runs it and waits. RanCleanly == false means
    // Error is final; otherwise the caller gets ExitCode/Stderr and applies its own MissingEnvVarExitCode rule.
    private async Task<(bool RanCleanly, string? Error, int ExitCode, string Stderr)> RunScriptAsync(
        string script, string workDir, TimeSpan extraTimeout,
        IReadOnlyDictionary<string, string>? extraEnvironmentVariables, CancellationToken ct)
    {
        var effectiveTimeout = _timeout + extraTimeout;
        var scriptPath = Path.Combine(workDir, "scraper.py");
        await File.WriteAllTextAsync(scriptPath, script, ct);

        var (process, executableUsed) = StartProcess(scriptPath, workDir, extraEnvironmentVariables);
        if (process is null)
        {
            return (false,
                $"No Python interpreter found (tried: {string.Join(", ", _candidates)}). " +
                "Is Python installed and available on the companion app's PATH?", -1, "");
        }

        using (process)
        {
            var stderrBuilder = new StringBuilder();
            process.ErrorDataReceived += (_, e) => { if (e.Data is not null) stderrBuilder.AppendLine(e.Data); };
            process.BeginErrorReadLine();

            // A script announces every pause / retry wait on stdout right before sleeping; each announcement extends
            // this run's deadline by exactly that wait (retries plus RetryAttemptAllowance), so pure waiting never
            // counts against the timeout while a stuck script still times out. The total extension is capped
            // (MaxRequestDelayExtension).
            long announcedPauseMs = 0;
            process.OutputDataReceived += (_, e) =>
            {
                if (e.Data is null) return;
                var pause = PauseAnnouncementPattern.Match(e.Data);
                var retry = pause.Success ? Match.Empty : RetryAnnouncementPattern.Match(e.Data);
                var match = pause.Success ? pause : retry;
                if (!match.Success || !double.TryParse(match.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds))
                    return;
                var extensionMs = (long)Math.Ceiling(seconds * 1000) + (retry.Success ? (long)RetryAttemptAllowance.TotalMilliseconds : 0);
                Interlocked.Add(ref announcedPauseMs, extensionMs);
            };
            process.BeginOutputReadLine();

            var started = Stopwatch.StartNew();
            var exitTask = process.WaitForExitAsync(ct);
            while (!exitTask.IsCompleted)
            {
                var pausedMs = Interlocked.Read(ref announcedPauseMs);
                if (pausedMs > MaxRequestDelayExtension.TotalMilliseconds)
                {
                    TryKill(process);
                    return (false,
                        $"Pauses between requests and retries of failed requests made the trial run wait for more than {MaxRequestDelayExtension.TotalMinutes:0} minutes in total " +
                        "— reduce the pause between requests or the number of retries, or the number of pages/requests (e.g. pagination's maximum page count).", -1, "");
                }

                var remaining = effectiveTimeout + TimeSpan.FromMilliseconds(pausedMs) - started.Elapsed;
                if (remaining <= TimeSpan.Zero)
                {
                    TryKill(process);
                    return (false, pausedMs > 0
                        ? string.Create(CultureInfo.InvariantCulture,
                            $"Script execution exceeded the {effectiveTimeout.TotalSeconds:0}s timeout (not counting {pausedMs / 1000.0:0.#}s of request-delay pauses and retries).")
                        : $"Script execution exceeded the {effectiveTimeout.TotalSeconds:0}s timeout.", -1, "");
                }

                await Task.WhenAny(exitTask, Task.Delay(remaining < PollInterval ? remaining : PollInterval, ct));
                ct.ThrowIfCancellationRequested();
            }
            await exitTask;
            process.WaitForExit(); // flushes the async stdout/stderr readers before stderrBuilder is read

            var stderr = stderrBuilder.ToString();
            if (process.ExitCode != 0 && process.ExitCode != MissingEnvVarExitCode && process.ExitCode != HardeningFailedExitCode)
            {
                return (false,
                    CleanScriptError(stderr)
                        ?? $"Script ({executableUsed}) exited with an error (exit code {process.ExitCode}): {Truncate(stderr)}",
                    process.ExitCode, stderr);
            }

            return (true, null, process.ExitCode, stderr);
        }
    }

    // A script that stops deliberately prints self-explanatory "ERROR: ..." lines to stderr and exits with its own
    // code: those lines are the error, not a wrapper around raw stderr. A Python traceback or no such line keeps
    // the full message, since raw stderr is then the only clue.
    private static string? CleanScriptError(string stderr)
    {
        if (stderr.Contains("Traceback (most recent call last)", StringComparison.Ordinal))
            return null;
        var errorLines = stderr.Split('\n')
            .Select(line => line.TrimEnd('\r'))
            .Where(line => line.StartsWith("ERROR: ", StringComparison.Ordinal))
            .Select(line => line["ERROR: ".Length..])
            .ToList();
        return errorLines.Count == 0 ? null : Truncate(string.Join("\n", errorLines));
    }

    // "At least one data row" (also covers a DiscoverySource that resolves to no values at run time).
    private static async Task<ScriptVerificationResult> VerifyCsvOutput(
        string workDir, string outputFileBaseName, bool includePreview, bool includeOutputFile, CancellationToken ct)
    {
        var csvFileName = $"{outputFileBaseName}.csv";
        var csvPath = Path.Combine(workDir, csvFileName);
        if (!File.Exists(csvPath))
            return new ScriptVerificationResult { Success = false, Error = $"Script did not produce {csvFileName}." };

        var lines = await File.ReadAllLinesAsync(csvPath, ct);
        var rowCount = Math.Max(0, lines.Length - 1); // minus header row

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
            // Issue #161: the raw file as written, not reconstructed from
            // `lines` (join/line-ending differences would make the download
            // not byte-identical to what the script produced).
            OutputFileContent = includeOutputFile ? await File.ReadAllTextAsync(csvPath, ct) : null,
            OutputFileName = includeOutputFile ? csvFileName : null,
        };
    }

    // The same check for the binary table formats, read back by a tiny Python helper (sqlite3 / openpyxl, which the
    // script needed anyway) so the companion needs no .NET dependency. The bytes are returned base64-encoded.
    private const string ReadTableScript = """
import json, sys
path, fmt, cap = sys.argv[1], sys.argv[2], int(sys.argv[3])
if fmt == "sqlite":
    import sqlite3
    connection = sqlite3.connect(path)
    cursor = connection.execute('SELECT * FROM "data"')
    columns = [d[0] for d in cursor.description]
    rows = cursor.fetchall()
else:
    from openpyxl import load_workbook
    sheet = load_workbook(path, read_only=True).active
    table = list(sheet.iter_rows(values_only=True))
    columns = [str(c) for c in table[0]] if table else []
    rows = table[1:]
text = lambda v: "" if v is None else str(v)
print(json.dumps({"columns": columns, "count": len(rows), "rows": [[text(v) for v in r] for r in rows[:cap]]}))
""";

    private async Task<ScriptVerificationResult> VerifyTabularOutputAsync(
        string workDir, OutputFormat format, string outputFileBaseName, bool includePreview, bool includeOutputFile, CancellationToken ct)
    {
        var fileName = ExpectedFileName(format, outputFileBaseName);
        var path = Path.Combine(workDir, fileName);
        if (!File.Exists(path))
            return new ScriptVerificationResult { Success = false, Error = $"Script did not produce {fileName}." };

        var helperPath = Path.Combine(workDir, "read_output.py");
        await File.WriteAllTextAsync(helperPath, ReadTableScript, ct);
        var (process, _) = StartProcess(helperPath, workDir, null, path, format == OutputFormat.Sqlite ? "sqlite" : "xlsx", PreviewSampleCap.ToString(CultureInfo.InvariantCulture));
        if (process is null)
            return new ScriptVerificationResult { Success = false, Error = "No Python interpreter found to read the output file back." };

        using (process)
        {
            var stdoutTask = process.StandardOutput.ReadToEndAsync(ct);
            var stderrTask = process.StandardError.ReadToEndAsync(ct);
            await process.WaitForExitAsync(ct);
            var stdout = await stdoutTask;
            if (process.ExitCode != 0)
                return new ScriptVerificationResult { Success = false, Error = $"Could not read {fileName} back: {Truncate(await stderrTask)}" };

            using var document = JsonDocument.Parse(stdout);
            var count = document.RootElement.GetProperty("count").GetInt32();
            if (count == 0)
            {
                return new ScriptVerificationResult
                {
                    Success = false,
                    Error = "Script ran without errors but returned no data " +
                            $"({fileName} contains only the header row) — at least one selector or request likely found nothing.",
                };
            }

            ScriptPreviewData? preview = null;
            if (includePreview)
            {
                var columns = document.RootElement.GetProperty("columns").EnumerateArray().Select(c => c.GetString() ?? "").ToList();
                var rows = document.RootElement.GetProperty("rows").EnumerateArray().Select(r =>
                {
                    var values = r.EnumerateArray().Select(v => v.GetString() ?? "").ToList();
                    var row = new Dictionary<string, string>();
                    for (var i = 0; i < columns.Count; i++)
                        row[columns[i]] = i < values.Count ? values[i] : "";
                    return (IReadOnlyDictionary<string, string>)row;
                }).ToList();
                preview = new ScriptPreviewData
                {
                    OutputFormat = format.ToString(), TotalCount = count, Truncated = count > PreviewSampleCap,
                    Columns = columns, Rows = rows,
                };
            }

            return new ScriptVerificationResult
            {
                Success = true, RowCount = count, Preview = preview,
                OutputFileContent = includeOutputFile ? Convert.ToBase64String(await File.ReadAllBytesAsync(path, ct)) : null,
                OutputFileEncoding = includeOutputFile ? "base64" : null,
                OutputFileName = includeOutputFile ? fileName : null,
            };
        }
    }

    // output.xml must exist, parse, and have at least one descendant element.
    private static ScriptVerificationResult VerifyXmlOutput(
        string workDir, string outputFileBaseName, bool includePreview, bool includeOutputFile = false)
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
            // Issue #161: the raw file as written, not XDocument's own
            // re-serialization — keeps the download byte-identical to what
            // the script actually produced.
            OutputFileContent = includeOutputFile ? File.ReadAllText(xmlPath) : null,
            OutputFileName = includeOutputFile ? xmlFileName : null,
        };
    }

    // output.json must exist and parse. A flat array of records and a nested object are told apart by the root's
    // JSON type.
    private static ScriptVerificationResult VerifyJsonOutput(
        string workDir, string outputFileBaseName, bool includePreview, bool includeOutputFile = false)
    {
        var jsonFileName = $"{outputFileBaseName}.json";
        var jsonPath = Path.Combine(workDir, jsonFileName);
        if (!File.Exists(jsonPath))
            return new ScriptVerificationResult { Success = false, Error = $"Script did not produce {jsonFileName}." };

        var rawContent = File.ReadAllText(jsonPath);
        var root = JsonNode.Parse(rawContent);

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
                OutputFileContent = includeOutputFile ? rawContent : null,
                OutputFileName = includeOutputFile ? jsonFileName : null,
            };
        }

        // Counts every object property and array item recursively (not equal to the XML element count; only
        // "greater than zero" matters).
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
            OutputFileContent = includeOutputFile ? rawContent : null,
            OutputFileName = includeOutputFile ? jsonFileName : null,
        };
    }

    private static int CountJsonNodes(JsonNode? node) => node switch
    {
        JsonObject obj => obj.Sum(property => 1 + CountJsonNodes(property.Value)),
        JsonArray arr => arr.Sum(item => 1 + CountJsonNodes(item)),
        _ => 0,
    };

    // Same Columns/Rows table as the CSV preview; the templates write plain strings, so GetValue<string>() is safe.
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

    // Caps only the top-level repeating structure (a top-level array property at PreviewSampleCap items). Re-parses
    // rather than mutating the caller's root.
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

    // A pretty-printed fragment with the first PreviewSampleCap top-level elements. Truncated compares top-level
    // elements, not elementCount (all descendants).
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

    // Splits a CSV line like csv.DictWriter's default dialect writes it; only needed for the preview sample.
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
        string scriptPath, string workDir, IReadOnlyDictionary<string, string>? extraEnv, params string[] arguments)
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
            foreach (var argument in arguments)
                psi.ArgumentList.Add(argument);
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
