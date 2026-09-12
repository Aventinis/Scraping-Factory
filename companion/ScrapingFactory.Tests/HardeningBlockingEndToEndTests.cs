using System.Diagnostics;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #132: real end-to-end proof that BlockingCheck's three signals
// (cross-origin redirect, short body, block phrase) actually fire at
// runtime — like NullRateCheck, a blocked-but-200 response can still
// produce a non-empty output file, so PythonScriptVerifier's own
// black-box success/failure result can't distinguish a triggered check
// from an untriggered one. Same RunScriptAsync pattern as
// HardeningNullRateEndToEndTests/HardeningBaselineEndToEndTests, for the
// same reason. Static engine only — see ProxyEndToEndTests' own doc
// comment for why Browser-engine coverage instead lives in template-string
// assertions (CompanionEndpointTests' round-trip test for this check).
public class HardeningBlockingEndToEndTests
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

    private static async Task<(int Exit, string Stderr)> GenerateAndRunAsync(ScrapingPlan plan, string tempPrefix)
    {
        var script = new PythonCodeGenerator().Generate(plan);
        var workDir = Directory.CreateTempSubdirectory(tempPrefix).FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            return await RunScriptAsync(scriptPath, workDir);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task CleanPage_NoBlockingSignals_ExitsCleanly()
    {
        using var server = new LocalTestServer(
            "<html><body><h1 class='item'>A perfectly ordinary, reasonably long page body.</h1></body></html>");
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = ".item" }],
            Hardening = [new BlockingCheck { Severity = HardeningSeverity.Error, MinBodyLength = 20, BlockPhrases = ["Access Denied"] }],
        };

        var (exit, stderr) = await GenerateAndRunAsync(plan, "scrapingfactory-blocking-test-");

        Assert.Equal(0, exit);
        Assert.Empty(stderr);
    }

    [Fact]
    public async Task ResponseShorterThanMinBodyLength_ExitsWithHardeningCode()
    {
        // Still matches the selector (so the run itself "succeeds" and
        // produces data) — the point is the body is short regardless.
        using var server = new LocalTestServer("<b class='item'>x</b>");
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = ".item" }],
            Hardening = [new BlockingCheck { Severity = HardeningSeverity.Error, MinBodyLength = 1000 }],
        };

        var (exit, stderr) = await GenerateAndRunAsync(plan, "scrapingfactory-blocking-test-");

        Assert.Equal(2, exit);
        Assert.Contains("ERROR", stderr);
        Assert.Contains("Possible blocking detected", stderr);
        Assert.Contains("bytes", stderr);
    }

    [Fact]
    public async Task ResponseContainingBlockPhrase_ExitsWithHardeningCode()
    {
        using var server = new LocalTestServer(
            "<html><body><h1 class='item'>Access Denied — please contact support.</h1></body></html>");
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = ".item" }],
            Hardening = [new BlockingCheck { Severity = HardeningSeverity.Error, BlockPhrases = ["Access Denied", "Please verify you are human"] }],
        };

        var (exit, stderr) = await GenerateAndRunAsync(plan, "scrapingfactory-blocking-test-");

        Assert.Equal(2, exit);
        Assert.Contains("ERROR", stderr);
        Assert.Contains("Access Denied", stderr);
    }

    // Case-insensitivity: the configured phrase and the page's own casing
    // deliberately differ.
    [Fact]
    public async Task BlockPhraseMatchIsCaseInsensitive()
    {
        using var server = new LocalTestServer("<html><body><h1 class='item'>ACCESS DENIED</h1></body></html>");
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = ".item" }],
            Hardening = [new BlockingCheck { Severity = HardeningSeverity.Warning, BlockPhrases = ["access denied"] }],
        };

        var (exit, stderr) = await GenerateAndRunAsync(plan, "scrapingfactory-blocking-test-");

        Assert.Equal(0, exit); // Warning severity never fails the run
        Assert.Contains("WARNING", stderr);
        Assert.Contains("Possible blocking detected", stderr);
    }

    // The cross-origin-redirect signal needs a real HTTP redirect to a
    // *different* host — two separate LocalTestServer instances (different
    // loopback ports) stand in for "redirected to a different origin"
    // (e.g. a CAPTCHA vendor or login subdomain).
    [Fact]
    public async Task RedirectToDifferentHost_ExitsWithHardeningCode()
    {
        using var blockPage = new LocalTestServer("<html><body>Please complete the CAPTCHA.</body></html>");
        using var mainServer = new LocalTestServer(request => new LocalTestServerResponse(
            "", "text/html", System.Net.HttpStatusCode.Found, Location: blockPage.BaseUrl));

        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [mainServer.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = ".item" }],
            Hardening = [new BlockingCheck { Severity = HardeningSeverity.Error }],
        };

        var (exit, stderr) = await GenerateAndRunAsync(plan, "scrapingfactory-blocking-test-");

        Assert.Equal(2, exit);
        Assert.Contains("ERROR", stderr);
        Assert.Contains("redirected to a different host", stderr);
    }

    // A same-host redirect (e.g. an ordinary http -> https or trailing-
    // slash redirect that `requests` follows transparently) must not be
    // mistaken for blocking — only a *different host* is a signal.
    [Fact]
    public async Task RedirectWithinSameHost_DoesNotTriggerRedirectSignal()
    {
        using var server = new LocalTestServer(request => request.Url!.AbsolutePath == "/"
            ? new LocalTestServerResponse("", "text/html", System.Net.HttpStatusCode.Found, Location: "/page")
            : new LocalTestServerResponse("<html><body><h1 class='item'>Fine</h1></body></html>", "text/html"));

        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = ".item" }],
            Hardening = [new BlockingCheck { Severity = HardeningSeverity.Error }],
        };

        var (exit, stderr) = await GenerateAndRunAsync(plan, "scrapingfactory-blocking-test-");

        Assert.Equal(0, exit);
        Assert.Empty(stderr);
    }
}
