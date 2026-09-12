using System.Diagnostics;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #88: real end-to-end proof that a generated static-engine script
// actually routes its request through a user-supplied proxy instead of
// connecting directly — the same "prove the exact artifact works"
// philosophy as ChangeDetectionEndToEndTests, and for the same reason
// these don't go through PythonScriptVerifier: proxy behavior only shows
// up once the real subprocess actually opens the connection, which the
// static-engine/requests-only path is fast and dependency-free enough to
// exercise directly here. Browser-engine (Playwright) proxy wiring stays
// covered by the template-string assertions in
// PythonPlaywrightCodeGeneratorTests instead — a full Chromium run against
// a fake proxy is disproportionate for this scope.
public class ProxyEndToEndTests
{
    private static async Task<(int ExitCode, string Stderr)> RunScriptAsync(
        string scriptPath, string workDir, IReadOnlyDictionary<string, string> env)
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
            foreach (var (key, value) in env)
                psi.Environment[key] = value;

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
    public async Task Static_RequestActuallyRoutesThroughConfiguredProxy()
    {
        using var pageServer = new LocalTestServer("<html><body><h1>Real Page</h1></body></html>");
        using var proxyServer = new LocalHttpProxyTestServer("<html><body><h1>Via Proxy</h1></body></html>");

        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [pageServer.BaseUrl] },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
            Proxy = new ProxyConfig { EnvironmentVariableName = "SF_TEST_PROXIES" },
        };
        var script = new PythonCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-proxy-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            var env = new Dictionary<string, string> { ["SF_TEST_PROXIES"] = proxyServer.BaseUrl };

            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir, env);
            Assert.Equal(0, exit);
            Assert.Empty(stderr);

            // The real page server's own content never reaches the output —
            // only the proxy's canned response does, proving the request was
            // actually routed through it rather than connecting directly.
            var outputPath = Path.Combine(workDir, "output.csv");
            var lines = await File.ReadAllLinesAsync(outputPath);
            Assert.Equal(2, lines.Length); // header + one data row
            Assert.Contains("Via Proxy", lines[1]);

            var requestLine = Assert.Single(proxyServer.ReceivedRequestLines);
            Assert.Contains(pageServer.BaseUrl, requestLine);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task Static_MultipleProxies_RotateRoundRobinAcrossStartUrls()
    {
        using var pageServerA = new LocalTestServer("<html><body><h1>Page A</h1></body></html>");
        using var pageServerB = new LocalTestServer("<html><body><h1>Page B</h1></body></html>");
        using var proxyServer1 = new LocalHttpProxyTestServer("<html><body><h1>Via Proxy 1</h1></body></html>");
        using var proxyServer2 = new LocalHttpProxyTestServer("<html><body><h1>Via Proxy 2</h1></body></html>");

        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [pageServerA.BaseUrl, pageServerB.BaseUrl] },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
            Proxy = new ProxyConfig { EnvironmentVariableName = "SF_TEST_PROXIES" },
        };
        var script = new PythonCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-proxy-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            var env = new Dictionary<string, string>
            {
                ["SF_TEST_PROXIES"] = $"{proxyServer1.BaseUrl},{proxyServer2.BaseUrl}",
            };

            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir, env);
            Assert.Equal(0, exit);
            Assert.Empty(stderr);

            // First start URL rotates to the first proxy, the second to the
            // second proxy — round-robin, one pick per request.
            var requestLine1 = Assert.Single(proxyServer1.ReceivedRequestLines);
            Assert.Contains(pageServerA.BaseUrl, requestLine1);
            var requestLine2 = Assert.Single(proxyServer2.ReceivedRequestLines);
            Assert.Contains(pageServerB.BaseUrl, requestLine2);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    // Issue #88 follow-up: when SF_TEST_PROXIES is missing entirely (as
    // opposed to set-but-empty) at runtime, the script must not crash with
    // a raw KeyError the way it used to — it should warn, connect directly,
    // still produce real data, and only flag the gap via a dedicated exit
    // code instead of the generic "something went wrong" code 1. This is
    // what makes /generate's own trial-run verification succeed even when
    // the companion's own process never had the env var set (see
    // PythonScriptVerifierTests.MissingProxyEnvVar_* for that side).
    [Fact]
    public async Task Static_MissingProxyEnvVar_WarnsAndConnectsDirectlyWithDedicatedExitCode()
    {
        using var pageServer = new LocalTestServer("<html><body><h1>Real Page</h1></body></html>");

        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [pageServer.BaseUrl] },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
            Proxy = new ProxyConfig { EnvironmentVariableName = "SF_TEST_PROXIES_UNSET" },
        };
        var script = new PythonCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-proxy-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);

            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir, new Dictionary<string, string>());
            Assert.Equal(78, exit);
            Assert.Contains("SF_TEST_PROXIES_UNSET", stderr);
            Assert.Contains("Warning", stderr);

            // Connected directly (no proxy configured) — the real page
            // server's own content reaches the output, unlike the
            // through-a-proxy test above.
            var outputPath = Path.Combine(workDir, "output.csv");
            var lines = await File.ReadAllLinesAsync(outputPath);
            Assert.Equal(2, lines.Length); // header + one data row
            Assert.Contains("Real Page", lines[1]);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }
}
