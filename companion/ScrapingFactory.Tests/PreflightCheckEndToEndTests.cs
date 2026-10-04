using System.Diagnostics;
using System.Net;
using System.Text.Json;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #219: real end-to-end proof that the preflight check actually
// compares ETag/Last-Modified across two separate script runs and skips the
// main extraction accordingly — same "inherently needs two real runs, which
// PythonScriptVerifier's always-fresh-temp-directory trial can never
// exercise" reasoning as HardeningBaselineEndToEndTests, which this file's
// own RunScriptAsync/workDir pattern mirrors directly.
public class PreflightCheckEndToEndTests
{
    private static async Task<(int ExitCode, string Stderr, string Stdout)> RunScriptAsync(string scriptPath, string workDir)
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
                return (process.ExitCode, await stderrTask, await stdoutTask);
            }
            catch (System.ComponentModel.Win32Exception ex)
            {
                lastError = ex; // executable not found — try the next candidate
            }
        }
        throw new InvalidOperationException("No Python interpreter found (tried: python3, python).", lastError);
    }

    private static ScrapingPlan FlatPlan(string url, ScrapingEngine engine = ScrapingEngine.Static) => new()
    {
        Steps = [new NavigateStep { Urls = [url] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
        Engine = engine,
        Preflight = true,
    };

    private static string GenerateScript(ScrapingPlan plan) =>
        plan.Engine == ScrapingEngine.Browser ? new PythonPlaywrightCodeGenerator().Generate(plan) : new PythonCodeGenerator().Generate(plan);

    [Fact]
    public async Task FirstRun_NoStateFileYet_ProceedsAndWritesInitialState()
    {
        using var server = new LocalTestServer(_ =>
            new LocalTestServerResponse("<html><body><h1>Titel</h1></body></html>", "text/html", Headers: new Dictionary<string, string> { ["ETag"] = "\"v1\"" }));
        var script = GenerateScript(FlatPlan(server.BaseUrl));

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-preflight-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);

            var (exit, stderr, _) = await RunScriptAsync(scriptPath, workDir);

            Assert.Equal(0, exit);
            Assert.Empty(stderr);
            Assert.True(File.Exists(Path.Combine(workDir, "output.csv")));
            var statePath = Path.Combine(workDir, "output.csv.preflight-state.json");
            Assert.True(File.Exists(statePath));
            using var doc = JsonDocument.Parse(await File.ReadAllTextAsync(statePath));
            Assert.Equal("\"v1\"", doc.RootElement.GetProperty("etag").GetString());
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task SecondRun_SameETag_ExitsUnchangedWithoutTouchingTheOutputFile()
    {
        using var server = new LocalTestServer(_ =>
            new LocalTestServerResponse("<html><body><h1>Titel</h1></body></html>", "text/html", Headers: new Dictionary<string, string> { ["ETag"] = "\"v1\"" }));
        var script = GenerateScript(FlatPlan(server.BaseUrl));

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-preflight-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            await File.WriteAllTextAsync(Path.Combine(workDir, "output.csv.preflight-state.json"), """{"etag": "\"v1\"", "lastModified": null}""");
            var outputPath = Path.Combine(workDir, "output.csv");
            await File.WriteAllTextAsync(outputPath, "stale-content-from-a-previous-run");

            var (exit, stderr, stdout) = await RunScriptAsync(scriptPath, workDir);

            Assert.Equal(4, exit);
            Assert.Empty(stderr);
            Assert.Contains("no change detected", stdout);
            // The main extraction never ran at all — the previous run's own
            // output file must be left exactly as it was.
            Assert.Equal("stale-content-from-a-previous-run", await File.ReadAllTextAsync(outputPath));
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task SecondRun_DifferentETag_ProceedsAndAdvancesState()
    {
        using var server = new LocalTestServer(_ =>
            new LocalTestServerResponse("<html><body><h1>Titel</h1></body></html>", "text/html", Headers: new Dictionary<string, string> { ["ETag"] = "\"v2\"" }));
        var script = GenerateScript(FlatPlan(server.BaseUrl));

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-preflight-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            var statePath = Path.Combine(workDir, "output.csv.preflight-state.json");
            await File.WriteAllTextAsync(statePath, """{"etag": "\"v1\"", "lastModified": null}""");

            var (exit, stderr, _) = await RunScriptAsync(scriptPath, workDir);

            Assert.Equal(0, exit);
            Assert.Empty(stderr);
            Assert.True(File.Exists(Path.Combine(workDir, "output.csv")));
            using var doc = JsonDocument.Parse(await File.ReadAllTextAsync(statePath));
            Assert.Equal("\"v2\"", doc.RootElement.GetProperty("etag").GetString());
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    // Neither ETag nor Last-Modified present at all — the check can't tell
    // "changed" from "unchanged", so it must conservatively proceed rather
    // than risk silently never updating stale data (the issue's own
    // documented limitation for targets that don't send useful headers).
    [Fact]
    public async Task NoComparableHeaders_AlwaysProceeds()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var script = GenerateScript(FlatPlan(server.BaseUrl));

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-preflight-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            await File.WriteAllTextAsync(Path.Combine(workDir, "output.csv.preflight-state.json"), "{}");

            var (exit, stderr, _) = await RunScriptAsync(scriptPath, workDir);

            Assert.Equal(0, exit);
            Assert.Empty(stderr);
            Assert.True(File.Exists(Path.Combine(workDir, "output.csv")));
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task UnreachableTarget_ExitsWithUnreachableCodeAndNeverWritesOutput()
    {
        // A loopback port nothing listens on — connection refused, the
        // cheapest reliable way to simulate "target unreachable" without
        // relying on the internet.
        var unreachableUrl = "http://127.0.0.1:1/";
        var script = GenerateScript(FlatPlan(unreachableUrl));

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-preflight-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);

            var (exit, stderr, _) = await RunScriptAsync(scriptPath, workDir);

            Assert.Equal(5, exit);
            Assert.Contains("unreachable", stderr);
            Assert.False(File.Exists(Path.Combine(workDir, "output.csv")));
            Assert.False(File.Exists(Path.Combine(workDir, "output.csv.preflight-state.json")));
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    // Browser-engine coverage: proves the preflight check's own freshly-
    // added `requests` import actually works inside a Playwright script too
    // (the mechanism itself is identical to the Static engine's — the point
    // here is that a skip never needs to launch a browser session at all).
    [Fact]
    public async Task Playwright_SameETag_ExitsUnchangedWithoutLaunchingABrowser()
    {
        using var server = new LocalTestServer(_ =>
            new LocalTestServerResponse("<html><body><h1>Titel</h1></body></html>", "text/html", Headers: new Dictionary<string, string> { ["ETag"] = "\"v1\"" }));
        var script = GenerateScript(FlatPlan(server.BaseUrl, ScrapingEngine.Browser));

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-preflight-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            await File.WriteAllTextAsync(Path.Combine(workDir, "output.csv.preflight-state.json"), """{"etag": "\"v1\"", "lastModified": null}""");

            var (exit, stderr, stdout) = await RunScriptAsync(scriptPath, workDir);

            Assert.Equal(4, exit);
            Assert.Empty(stderr);
            Assert.Contains("no change detected", stdout);
            Assert.False(File.Exists(Path.Combine(workDir, "output.csv")));
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }
}
