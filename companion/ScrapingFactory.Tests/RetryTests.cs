using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #223: retry with backoff on transient request failures —
// validation, the rendered script, and real runs against a LocalTestServer
// that fails a given number of times first (static, API, Browser engine),
// plus the trial-run verifier extending its deadline by announced retries.
public class RetryTests
{
    private static PlanValidationResult Validate(RetryConfig retry) => ScrapingPlanValidator.Validate(new ScrapingPlan
    {
        Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
        Retry = retry,
    });

    [Fact]
    public void Validate_Defaults_Pass()
    {
        var result = Validate(new RetryConfig());
        Assert.True(result.Success, result.Error);
    }

    [Theory]
    [InlineData(1, 2000, null, "MaxAttempts")]
    [InlineData(11, 2000, null, "MaxAttempts")]
    [InlineData(3, -1, null, "DelayMs")]
    [InlineData(3, 60_001, null, "DelayMs")]
    [InlineData(3, 2000, new[] { 200 }, "400-599")]
    [InlineData(3, 2000, new[] { 503, 503 }, "duplicates")]
    public void Validate_InvalidValues_Fail(int maxAttempts, int delayMs, int[]? codes, string expected)
    {
        var result = Validate(new RetryConfig { MaxAttempts = maxAttempts, DelayMs = delayMs, RetryOnStatusCodes = codes?.ToList() });
        Assert.False(result.Success);
        Assert.Contains(expected, result.Error);
    }

    private static ScrapingPlan FlatPlan(string url, RetryConfig? retry, ScrapingEngine engine = ScrapingEngine.Static) => new()
    {
        Steps = [new NavigateStep { Urls = [url] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
        Retry = retry,
        Engine = engine,
    };

    [Fact]
    public void GeneratedScript_WithoutRetry_HasNoRetryHelper()
    {
        var script = new PythonCodeGenerator().Generate(FlatPlan("https://example.com", null));
        Assert.DoesNotContain("_send_with_retry", script);
    }

    [Fact]
    public void GeneratedScript_WithRetry_RendersSettings()
    {
        var script = new PythonCodeGenerator().Generate(FlatPlan("https://example.com",
            new RetryConfig { MaxAttempts = 4, DelayMs = 1500, Exponential = false, RetryOnStatusCodes = [503, 500] }));
        Assert.Contains("RETRY_MAX_ATTEMPTS = 4", script);
        Assert.Contains("RETRY_DELAY_S = 1.5", script);
        Assert.Contains("RETRY_EXPONENTIAL = False", script);
        Assert.Contains("RETRY_ON_STATUS_CODES = {500, 503}", script);
        Assert.Contains("response = _send_with_retry(lambda _u=page_url: requests.get(_u,", script);
    }

    [Fact]
    public void BrowserScript_RetriesTheFirstNavigationOnly_NotTheLoginActions()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ClickStep { Selector = "#login" },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
            Engine = ScrapingEngine.Browser,
            Retry = new RetryConfig(),
        };
        var script = new PythonPlaywrightCodeGenerator().Generate(plan);
        Assert.Contains("_send_with_retry(lambda: page.goto(url, wait_until=\"load\", timeout=30000), url)", script);
        Assert.DoesNotContain("_send_with_retry(lambda: page.click", script);
    }

    // ── Real runs ────────────────────────────────────────────────────────────

    // Answers `failures` requests with `failure`, then succeeds with `success`;
    // records every request's arrival time.
    private sealed class FlakyServer : IDisposable
    {
        private readonly Stopwatch _clock = Stopwatch.StartNew();
        private int _count;
        public ConcurrentQueue<(string Path, long AtMs)> Requests { get; } = new();
        public LocalTestServer Server { get; }

        public FlakyServer(int failures, Func<LocalTestServerResponse> failure, Func<LocalTestServerResponse> success)
        {
            Server = new LocalTestServer(request =>
            {
                if (request.Url!.AbsolutePath.Contains("favicon"))
                    return new LocalTestServerResponse("", "text/plain", HttpStatusCode.NotFound);
                Requests.Enqueue((request.Url.PathAndQuery, _clock.ElapsedMilliseconds));
                return Interlocked.Increment(ref _count) <= failures ? failure() : success();
            });
        }

        public void Dispose() => Server.Dispose();
    }

    private static LocalTestServerResponse Html() => new("<html><body><h1>Seite</h1></body></html>", "text/html; charset=utf-8");
    private static LocalTestServerResponse Status(HttpStatusCode code, IReadOnlyDictionary<string, string>? headers = null) =>
        new("oops", "text/plain", code, Headers: headers);

    [Fact]
    public async Task Static_TransientServiceUnavailable_IsRetriedUntilItSucceeds()
    {
        using var flaky = new FlakyServer(2, () => Status(HttpStatusCode.ServiceUnavailable), Html);
        var script = new PythonCodeGenerator().Generate(FlatPlan(flaky.Server.BaseUrl, new RetryConfig { MaxAttempts = 3, DelayMs = 100 }));

        var (exitCode, stdout, _) = await RunScriptAsync(script);

        Assert.Equal(0, exitCode);
        Assert.Equal(3, flaky.Requests.Count);
        Assert.Contains("Retrying in 0.1 s (attempt 2 of 3) after HTTP 503:", stdout);
        Assert.Contains("Retrying in 0.2 s (attempt 3 of 3) after HTTP 503:", stdout); // exponential: 0.1 → 0.2
    }

    [Fact]
    public async Task TooManyRequests_HonorsRetryAfterInsteadOfTheConfiguredDelay()
    {
        using var flaky = new FlakyServer(1, () => Status((HttpStatusCode)429, new Dictionary<string, string> { ["Retry-After"] = "1" }), Html);
        var script = new PythonCodeGenerator().Generate(FlatPlan(flaky.Server.BaseUrl, new RetryConfig { MaxAttempts = 2, DelayMs = 0 }));

        var (exitCode, stdout, _) = await RunScriptAsync(script);

        Assert.Equal(0, exitCode);
        var times = flaky.Requests.Select(r => r.AtMs).ToList();
        Assert.True(times[1] - times[0] >= 950, $"retried after {times[1] - times[0]} ms despite Retry-After: 1");
        Assert.Contains("Retrying in 1.0 s (attempt 2 of 2) after HTTP 429:", stdout);
    }

    [Fact]
    public async Task NonRetryableStatus_IsNotRetried()
    {
        using var flaky = new FlakyServer(1, () => Status(HttpStatusCode.Forbidden), Html);
        var script = new PythonCodeGenerator().Generate(FlatPlan(flaky.Server.BaseUrl, new RetryConfig { MaxAttempts = 3, DelayMs = 100 }));

        var (_, stdout, _) = await RunScriptAsync(script);

        Assert.Single(flaky.Requests);
        Assert.DoesNotContain("Retrying in", stdout);
    }

    [Fact]
    public async Task ExhaustedRetries_FailExactlyLikeWithoutRetries()
    {
        using var flaky = new FlakyServer(int.MaxValue, () => Status(HttpStatusCode.ServiceUnavailable), Html);
        var withRetry = await RunScriptAsync(new PythonCodeGenerator().Generate(FlatPlan(flaky.Server.BaseUrl, new RetryConfig { MaxAttempts = 2, DelayMs = 50 })));
        var requestsWithRetry = flaky.Requests.Count;
        var withoutRetry = await RunScriptAsync(new PythonCodeGenerator().Generate(FlatPlan(flaky.Server.BaseUrl, null)));

        Assert.Equal(2, requestsWithRetry);
        Assert.Equal(withoutRetry.ExitCode, withRetry.ExitCode);
        Assert.NotEqual(0, withRetry.ExitCode);
    }

    [Fact]
    public async Task Api_UnreachableHost_IsRetriedThenReportedCleanly()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ApiCallStep { Config = new ApiConfig { UrlTemplate = $"http://127.0.0.1:{port}/api/items", ItemsPath = "items", Fields = [new ApiField { Name = "T", Path = "t" }] } },
            ],
            Engine = ScrapingEngine.Api,
            Retry = new RetryConfig { MaxAttempts = 2, DelayMs = 100 },
        };

        var (exitCode, stdout, stderr) = await RunScriptAsync(new PythonApiCodeGenerator().Generate(plan));

        Assert.Equal(7, exitCode); // EXIT_REQUEST_FAILED — the clean API error once retries are exhausted
        Assert.Contains("Retrying in 0.1 s (attempt 2 of 2) after ConnectionError:", stdout);
        Assert.Contains("could not reach the API (ConnectionError)", stderr);
    }

    [Fact]
    public async Task Api_NotFoundCombination_IsStillSkipped_NotRetried()
    {
        using var flaky = new FlakyServer(1, () => Status(HttpStatusCode.NotFound),
            () => new LocalTestServerResponse("""{ "items": [ { "t": "x" } ] }""", "application/json"));
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ApiCallStep
                {
                    Config = new ApiConfig
                    {
                        UrlTemplate = $"{flaky.Server.BaseUrl}items/{{c}}",
                        ItemsPath = "items",
                        Fields = [new ApiField { Name = "T", Path = "t" }],
                        Parameters = [new ApiParameter { Name = "c", Source = new StaticListSource { Values = ["a", "b"] } }],
                    },
                },
            ],
            Engine = ScrapingEngine.Api,
            Retry = new RetryConfig { MaxAttempts = 3, DelayMs = 100 },
        };

        var (exitCode, stdout, _) = await RunScriptAsync(new PythonApiCodeGenerator().Generate(plan));

        Assert.Equal(0, exitCode);
        Assert.Equal(2, flaky.Requests.Count);
        Assert.Contains("Skipped (404 Not Found)", stdout);
        Assert.DoesNotContain("Retrying in", stdout);
    }

    [Fact]
    public async Task Browser_TransientNavigationFailure_IsRetried()
    {
        using var flaky = new FlakyServer(1, () => Status(HttpStatusCode.BadGateway), Html);
        var script = new PythonPlaywrightCodeGenerator().Generate(FlatPlan(flaky.Server.BaseUrl, new RetryConfig { MaxAttempts = 3, DelayMs = 100 }, ScrapingEngine.Browser));

        var (exitCode, stdout, stderr) = await RunScriptAsync(script);

        Assert.True(exitCode == 0, stderr);
        Assert.Equal(2, flaky.Requests.Count);
        Assert.Contains("after HTTP 502:", stdout);
    }

    // Issue #222 × #223: a retry is a request too — with a 1 s pause between
    // requests configured, even a 0.1 s retry backoff can't send the retry
    // sooner than 1 s after the failed attempt.
    [Fact]
    public async Task Retry_RespectsThePauseBetweenRequests()
    {
        using var flaky = new FlakyServer(1, () => Status(HttpStatusCode.ServiceUnavailable), Html);
        var plan = FlatPlan(flaky.Server.BaseUrl, new RetryConfig { MaxAttempts = 2, DelayMs = 100 });
        var paced = new ScrapingPlan { Steps = plan.Steps, Retry = plan.Retry, RequestDelay = new RequestDelayConfig { MinMs = 1000, MaxMs = 1000 } };

        var (exitCode, _, stderr) = await RunScriptAsync(new PythonCodeGenerator().Generate(paced));

        Assert.True(exitCode == 0, stderr);
        var times = flaky.Requests.Select(r => r.AtMs).ToList();
        Assert.True(times[1] - times[0] >= 950, $"retry sent after {times[1] - times[0]} ms despite a 1 s pause between requests");
    }

    [Fact]
    public async Task Verifier_ExtendsItsDeadlineByAnnouncedRetries()
    {
        // Two retries × 1.5 s wait — beyond this verifier's own 1 s timeout.
        using var flaky = new FlakyServer(2, () => Status(HttpStatusCode.ServiceUnavailable), Html);
        var script = new PythonCodeGenerator().Generate(FlatPlan(flaky.Server.BaseUrl, new RetryConfig { MaxAttempts = 3, DelayMs = 1500, Exponential = false }));

        var result = await new PythonScriptVerifier(timeout: TimeSpan.FromSeconds(1)).VerifyAsync(script);

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, flaky.Requests.Count);
    }

    private static async Task<(int ExitCode, string Stdout, string Stderr)> RunScriptAsync(string script)
    {
        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-retry-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            foreach (var candidate in new[] { "python3", "python" })
            {
                var psi = new ProcessStartInfo
                {
                    FileName = candidate, WorkingDirectory = workDir,
                    RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true,
                };
                psi.ArgumentList.Add(scriptPath);
                try
                {
                    using var process = new Process { StartInfo = psi };
                    process.Start();
                    var stderrTask = process.StandardError.ReadToEndAsync();
                    var stdoutTask = process.StandardOutput.ReadToEndAsync();
                    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
                    await process.WaitForExitAsync(cts.Token);
                    return (process.ExitCode, await stdoutTask, await stderrTask);
                }
                catch (System.ComponentModel.Win32Exception)
                {
                    // executable not found — try the next candidate
                }
            }
            throw new InvalidOperationException("No python3/python executable found.");
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }
}
