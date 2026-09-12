using System.Diagnostics;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #130: real end-to-end proof that NullRateCheck actually fires at
// runtime — unlike NoResultCheck (see PythonScriptVerifierTests), a script
// with a high per-field null rate still produces a non-empty output file, so
// PythonScriptVerifier's own "did it produce data" check can't tell the
// difference; only running the generated script directly and inspecting its
// exit code/stderr proves the check itself works. Same RunScriptAsync
// pattern as ProxyEndToEndTests/ChangeDetectionEndToEndTests, for the same
// reason.
public class HardeningNullRateEndToEndTests
{
    private static async Task<(int ExitCode, string Stderr)> RunScriptAsync(string scriptPath, string workDir)
    {
        Exception? lastError = null;
        foreach (var candidate in new[] { "python3", "python" })
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
                using var process = new Process { StartInfo = psi };
                process.Start();
                var stderrTask = process.StandardError.ReadToEndAsync();
                var stdoutTask = process.StandardOutput.ReadToEndAsync();
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                await process.WaitForExitAsync(cts.Token);
                return (process.ExitCode, await stderrTask);
            }
            catch (System.ComponentModel.Win32Exception ex)
            {
                lastError = ex; // executable not found — try the next candidate
            }
        }
        throw new InvalidOperationException("No Python interpreter found (tried: python3, python).", lastError);
    }

    [Fact]
    public async Task Static_FlatMode_FieldAlwaysEmpty_AboveThreshold_ExitsWithHardeningCode()
    {
        using var server = new LocalTestServer(
            "<html><body><h1 class='item'>A</h1><h1 class='item'>B</h1><h1 class='item'>C</h1></body></html>");

        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractStep { Name = "Titel", Selector = ".item" },
                new ExtractStep { Name = "Preis", Selector = ".price" }, // never matches -> always empty
            ],
            Hardening = [new NullRateCheck { Severity = HardeningSeverity.Error, FieldName = "Preis", Threshold = 0.3 }],
        };
        var script = new PythonCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-nullrate-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);

            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir);

            Assert.Equal(2, exit);
            Assert.Contains("ERROR", stderr);
            Assert.Contains("Preis", stderr);

            // The run still completed and wrote its output — hardening
            // failure is reported alongside a genuinely successful scrape,
            // not instead of one.
            var outputPath = Path.Combine(workDir, "output.csv");
            var lines = await File.ReadAllLinesAsync(outputPath);
            Assert.Equal(4, lines.Length); // header + 3 data rows
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task Static_FlatMode_FieldBelowThreshold_ExitsCleanly()
    {
        using var server = new LocalTestServer(
            "<html><body>"
            + "<div class='item'><h1>A</h1><span class='price'>1</span></div>"
            + "<div class='item'><h1>B</h1><span class='price'>2</span></div>"
            + "<div class='item'><h1>C</h1></body></html>");

        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractStep { Name = "Titel", Selector = ".item h1" },
                new ExtractStep { Name = "Preis", Selector = ".price" }, // matches 2 of 3 -> 33% empty
            ],
            // Threshold high enough that a 1-in-3 empty rate doesn't trip it.
            Hardening = [new NullRateCheck { Severity = HardeningSeverity.Error, FieldName = "Preis", Threshold = 0.5 }],
        };
        var script = new PythonCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-nullrate-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);

            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir);

            Assert.Equal(0, exit);
            Assert.Empty(stderr);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    // Proves the check is matched globally by tag name across the whole
    // output tree (the "global per field name" scoping decision, see
    // NullRateCheck's own doc comment) — not the flat engine's own
    // dict-row lookup, wiring-wise a fully separate code path.
    [Fact]
    public async Task Static_ContainerMode_FieldAlwaysEmptyAcrossAllInstances_ExitsWithHardeningCode()
    {
        using var server = new LocalTestServer(
            "<html><body>"
            + "<div class='item'><h3>Suppe</h3></div>"
            + "<div class='item'><h3>Salat</h3></div>"
            + "</body></html>");

        var root = new GroupNode
        {
            Name = "Gericht", Selector = ".item", Repeating = true,
            Children =
            [
                new DataFieldNode { Name = "Name", Selector = "h3" },
                new DataFieldNode { Name = "Preis", Selector = ".price" }, // never matches
            ],
        };
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractGroupStep { Roots = [root] },
            ],
            OutputFormat = OutputFormat.Xml,
            Hardening = [new NullRateCheck { Severity = HardeningSeverity.Error, FieldName = "Preis", Threshold = 0.3 }],
        };
        var script = new PythonCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-nullrate-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);

            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir);

            Assert.Equal(2, exit);
            Assert.Contains("ERROR", stderr);
            Assert.Contains("Preis", stderr);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }
}
