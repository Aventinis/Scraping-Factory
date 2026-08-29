using System.ComponentModel;
using System.Diagnostics;
using System.Text;
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

    private readonly TimeSpan _timeout = timeout ?? DefaultTimeout;
    private readonly string[] _candidates = pythonExecutable is not null ? [pythonExecutable] : DefaultCandidates;

    public string LanguageId => "python";

    public async Task<ScriptVerificationResult> VerifyAsync(
        string script, OutputFormat outputFormat = OutputFormat.Csv, string outputFileBaseName = "output",
        CancellationToken ct = default)
    {
        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-verify-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script, ct);

            var (process, executableUsed) = StartProcess(scriptPath, workDir);
            if (process is null)
            {
                return new ScriptVerificationResult
                {
                    Success = false,
                    Error = $"Kein Python-Interpreter gefunden (versucht: {string.Join(", ", _candidates)}). " +
                            "Ist Python installiert und im PATH der Companion App verfügbar?",
                };
            }

            using (process)
            {
                var stderrBuilder = new StringBuilder();
                process.ErrorDataReceived += (_, e) => { if (e.Data is not null) stderrBuilder.AppendLine(e.Data); };
                process.BeginErrorReadLine();
                var stdoutTask = process.StandardOutput.ReadToEndAsync(ct);

                using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeoutCts.CancelAfter(_timeout);
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
                        Error = $"Skript-Ausführung hat das Zeitlimit von {_timeout.TotalSeconds:0}s überschritten.",
                    };
                }
                await stdoutTask;

                if (process.ExitCode != 0)
                {
                    return new ScriptVerificationResult
                    {
                        Success = false,
                        Error = $"Skript ({executableUsed}) wurde mit Fehler beendet (Exit-Code {process.ExitCode}): " +
                                Truncate(stderrBuilder.ToString()),
                    };
                }
            }

            if (outputFormat == OutputFormat.Xml)
                return VerifyXmlOutput(workDir, outputFileBaseName);

            var csvFileName = $"{outputFileBaseName}.csv";
            var csvPath = Path.Combine(workDir, csvFileName);
            if (!File.Exists(csvPath))
            {
                return new ScriptVerificationResult { Success = false, Error = $"Skript hat keine {csvFileName} erzeugt." };
            }

            var lines = await File.ReadAllLinesAsync(csvPath, ct);
            var rowCount = Math.Max(0, lines.Length - 1); // minus header row

            // Also covers API-Mode's 0-combinations edge case (a
            // DiscoverySource resolving to no values at runtime, despite
            // ScrapingPlanValidator requiring at least one parameter with a
            // non-empty static list/range at config time) — treated
            // identically to any other 0-row result, not a special case.
            return rowCount > 0
                ? new ScriptVerificationResult { Success = true, RowCount = rowCount }
                : new ScriptVerificationResult
                {
                    Success = false,
                    Error = "Skript lief fehlerfrei, hat aber keine Daten zurückgegeben " +
                            $"({csvFileName} enthält nur die Kopfzeile) — mindestens ein Selektor bzw. eine Anfrage findet vermutlich nichts.",
                };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return new ScriptVerificationResult { Success = false, Error = $"Verifikation fehlgeschlagen: {ex.Message}" };
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
    private static ScriptVerificationResult VerifyXmlOutput(string workDir, string outputFileBaseName)
    {
        var xmlFileName = $"{outputFileBaseName}.xml";
        var xmlPath = Path.Combine(workDir, xmlFileName);
        if (!File.Exists(xmlPath))
            return new ScriptVerificationResult { Success = false, Error = $"Skript hat keine {xmlFileName} erzeugt." };

        var document = XDocument.Load(xmlPath);
        var elementCount = document.Root?.Descendants().Count() ?? 0;

        return elementCount > 0
            ? new ScriptVerificationResult { Success = true, RowCount = elementCount }
            : new ScriptVerificationResult
            {
                Success = false,
                Error = "Skript lief fehlerfrei, hat aber keine Daten zurückgegeben " +
                        $"({xmlFileName} enthält keine Elemente) — mindestens ein Selektor findet vermutlich nichts.",
            };
    }

    private (Process? Process, string? Executable) StartProcess(string scriptPath, string workDir)
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
        return trimmed.Length <= max ? trimmed : trimmed[..max] + "… (gekürzt)";
    }
}
