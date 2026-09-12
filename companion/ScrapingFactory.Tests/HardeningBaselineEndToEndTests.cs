using System.Diagnostics;
using System.Text.Json;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #131: real end-to-end proof that BaselineCheck's sidecar file
// actually persists a result count between two separate script runs and
// compares against it correctly — this is inherently something
// PythonScriptVerifier's single-run trial can never exercise (its temp
// directory is always fresh, so a baseline file could never already exist
// there), and there's no other way to prove "a bad run must never become
// the new normal" than actually running the script twice and inspecting
// the sidecar file's own content in between. Same RunScriptAsync pattern as
// HardeningNullRateEndToEndTests/ProxyEndToEndTests, for the same reason.
public class HardeningBaselineEndToEndTests
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

    private static string BuildPageWithItems(int count)
    {
        var items = string.Join("", Enumerable.Range(1, count).Select(i => $"<h1 class='item'>Item {i}</h1>"));
        return $"<html><body>{items}</body></html>";
    }

    private static int? ReadBaselineCount(string baselinePath)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(baselinePath));
        return doc.RootElement.GetProperty("count").GetInt32();
    }

    [Fact]
    public async Task FirstRun_NoBaselineFileYet_PassesCleanlyAndWritesInitialBaseline()
    {
        using var server = new LocalTestServer(BuildPageWithItems(10));
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = ".item" }],
            Hardening = [new BaselineCheck { Severity = HardeningSeverity.Error, DropThreshold = 0.2 }],
        };
        var script = new PythonCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-baseline-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);

            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir);

            Assert.Equal(0, exit);
            Assert.Empty(stderr);
            var baselinePath = Path.Combine(workDir, "output.csv.hardening-baseline.json");
            Assert.True(File.Exists(baselinePath));
            Assert.Equal(10, ReadBaselineCount(baselinePath));
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task SecondRun_CountDropsPastThreshold_ExitsWithHardeningCodeAndLeavesBaselineUnchanged()
    {
        using var server = new LocalTestServer(BuildPageWithItems(5)); // 50% drop from a baseline of 10
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = ".item" }],
            Hardening = [new BaselineCheck { Severity = HardeningSeverity.Error, DropThreshold = 0.2 }],
        };
        var script = new PythonCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-baseline-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            var baselinePath = Path.Combine(workDir, "output.csv.hardening-baseline.json");
            await File.WriteAllTextAsync(baselinePath, """{"count": 10}""");

            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir);

            Assert.Equal(2, exit);
            Assert.Contains("ERROR", stderr);
            Assert.Contains("10", stderr);
            Assert.Contains("5", stderr);

            // The failing run's own low count must never become the new
            // baseline — otherwise a real, ongoing regression would erase
            // itself from view after exactly one bad run.
            Assert.Equal(10, ReadBaselineCount(baselinePath));

            // The run still completed and wrote its (smaller) output —
            // hardening failure is reported alongside a technically
            // successful scrape, not instead of one.
            var lines = await File.ReadAllLinesAsync(Path.Combine(workDir, "output.csv"));
            Assert.Equal(6, lines.Length); // header + 5 data rows
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task SecondRun_CountWithinThreshold_ExitsCleanlyAndAdvancesBaseline()
    {
        using var server = new LocalTestServer(BuildPageWithItems(9)); // 10% drop from a baseline of 10, under the 20% threshold
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = ".item" }],
            Hardening = [new BaselineCheck { Severity = HardeningSeverity.Error, DropThreshold = 0.2 }],
        };
        var script = new PythonCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-baseline-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            var baselinePath = Path.Combine(workDir, "output.csv.hardening-baseline.json");
            await File.WriteAllTextAsync(baselinePath, """{"count": 10}""");

            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir);

            Assert.Equal(0, exit);
            Assert.Empty(stderr);
            // A clean run advances the baseline forward to the new count,
            // so a *further* gradual drop next time is still measured
            // against the most recent good run, not the original one.
            Assert.Equal(9, ReadBaselineCount(baselinePath));
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    // "The baseline file is only updated after a run that itself passed
    // cleanly" (the issue's own wording) means "the run didn't hard-fail",
    // i.e. hardening_failed stays False — exactly the same has_error
    // semantics severity already has everywhere else in this mechanism
    // (Warning only ever changes what's printed/exit code, never any other
    // behavior). So a Warning-severity trigger, unlike an Error one, still
    // advances the baseline: the run "passed cleanly" in that sense even
    // though it printed a warning about the drop.
    [Fact]
    public async Task WarningSeverity_CountDropsPastThreshold_ExitsCleanlyAndStillAdvancesBaseline()
    {
        using var server = new LocalTestServer(BuildPageWithItems(5));
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = ".item" }],
            Hardening = [new BaselineCheck { Severity = HardeningSeverity.Warning, DropThreshold = 0.2 }],
        };
        var script = new PythonCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-baseline-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            var baselinePath = Path.Combine(workDir, "output.csv.hardening-baseline.json");
            await File.WriteAllTextAsync(baselinePath, """{"count": 10}""");

            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir);

            Assert.Equal(0, exit);
            Assert.Contains("WARNING", stderr);
            Assert.Equal(5, ReadBaselineCount(baselinePath));
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }
}
