using System.Collections.Concurrent;
using System.Diagnostics;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #222: optional pause between outbound requests — validation, the
// rendered script, real runs measuring the actual gaps a LocalTestServer
// sees (static/pagination, API parameter combinations, Browser engine), and
// the trial-run verifier extending its deadline by every announced pause.
public class RequestDelayTests
{
    private static PlanValidationResult Validate(RequestDelayConfig delay) => ScrapingPlanValidator.Validate(new ScrapingPlan
    {
        Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
        RequestDelay = delay,
    });

    [Theory]
    [InlineData(0, 0)]
    [InlineData(1500, 1500)]
    [InlineData(1000, 3000)]
    [InlineData(0, 60_000)]
    public void Validate_SensibleRange_Passes(int minMs, int maxMs)
    {
        var result = Validate(new RequestDelayConfig { MinMs = minMs, MaxMs = maxMs });
        Assert.True(result.Success, result.Error);
    }

    [Theory]
    [InlineData(-1, 100, "must not be negative")]
    [InlineData(2000, 1000, "must not be smaller")]
    [InlineData(0, 60_001, "must not exceed")]
    public void Validate_InvalidRange_Fails(int minMs, int maxMs, string expected)
    {
        var result = Validate(new RequestDelayConfig { MinMs = minMs, MaxMs = maxMs });
        Assert.False(result.Success);
        Assert.Contains(expected, result.Error);
    }

    private static ScrapingPlan FlatPlan(string url, RequestDelayConfig? delay, PaginationConfig? pagination = null, ScrapingEngine engine = ScrapingEngine.Static) => new()
    {
        Steps = [new NavigateStep { Urls = [url] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
        RequestDelay = delay,
        Pagination = pagination,
        Engine = engine,
    };

    [Fact]
    public void GeneratedScript_WithoutDelay_HasNoPacing()
    {
        var script = new PythonCodeGenerator().Generate(FlatPlan("https://example.com", null));
        Assert.DoesNotContain("_pace_request", script);
        Assert.DoesNotContain("REQUEST_DELAY_MIN_S", script);
    }

    [Fact]
    public void GeneratedScript_WithDelay_RendersBoundsInSeconds()
    {
        var script = new PythonCodeGenerator().Generate(FlatPlan("https://example.com", new RequestDelayConfig { MinMs = 1500, MaxMs = 2250 }));
        Assert.Contains("REQUEST_DELAY_MIN_S = 1.5", script);
        Assert.Contains("REQUEST_DELAY_MAX_S = 2.25", script);
        Assert.Contains("def _pace_request():", script);
    }

    [Fact]
    public void BrowserScript_PacesBeforeTheFirstNavigation()
    {
        var script = new PythonPlaywrightCodeGenerator().Generate(FlatPlan("https://example.com", new RequestDelayConfig { MinMs = 500, MaxMs = 500 }, engine: ScrapingEngine.Browser));
        var pace = script.IndexOf("        _pace_request()\n", StringComparison.Ordinal);
        var firstGoto = script.IndexOf("page.goto(url", StringComparison.Ordinal);
        Assert.True(pace >= 0 && pace < firstGoto, "expected _pace_request() before the first page.goto");
    }

    // ── Real runs: measure what the server actually sees ─────────────────────

    private sealed class TimedServer : IDisposable
    {
        private readonly Stopwatch _clock = Stopwatch.StartNew();
        public ConcurrentQueue<(string PathAndQuery, long AtMs)> Requests { get; } = new();
        public LocalTestServer Server { get; }

        public TimedServer(Func<System.Net.HttpListenerRequest, LocalTestServerResponse> respond)
        {
            Server = new LocalTestServer(request =>
            {
                Requests.Enqueue((request.Url!.PathAndQuery, _clock.ElapsedMilliseconds));
                return respond(request);
            });
        }

        public List<long> Gaps()
        {
            var times = Requests.Select(r => r.AtMs).ToList();
            return times.Zip(times.Skip(1), (a, b) => b - a).ToList();
        }

        public void Dispose() => Server.Dispose();
    }

    private static LocalTestServerResponse Html(string body) => new($"<html><body>{body}</body></html>", "text/html; charset=utf-8");

    [Fact]
    public async Task StaticPagination_WaitsBetweenEveryPage()
    {
        using var timed = new TimedServer(_ => Html("<h1>Seite</h1>"));
        var plan = FlatPlan(timed.Server.BaseUrl, new RequestDelayConfig { MinMs = 400, MaxMs = 400 },
            new PageNumberPagination { UrlTemplate = "{url}?page={page}", MaxPages = 3 });

        var result = await new PythonScriptVerifier().VerifyAsync(new PythonCodeGenerator().Generate(plan));

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, timed.Requests.Count);
        Assert.All(timed.Gaps(), gap => Assert.True(gap >= 380, $"gap {gap} ms < 400 ms pause"));
    }

    [Fact]
    public async Task ApiParameterCombinations_WaitBetweenEveryRequest_WithinTheJitterRange()
    {
        using var timed = new TimedServer(_ => new LocalTestServerResponse("""{ "items": [ { "title": "x" } ] }""", "application/json"));
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ApiCallStep
                {
                    Config = new ApiConfig
                    {
                        UrlTemplate = $"{timed.Server.BaseUrl}items?c={{c}}",
                        ItemsPath = "items",
                        Fields = [new ApiField { Name = "Titel", Path = "title" }],
                        Parameters = [new ApiParameter { Name = "c", Source = new StaticListSource { Values = ["a", "b", "c", "d"] } }],
                    },
                },
            ],
            Engine = ScrapingEngine.Api,
            RequestDelay = new RequestDelayConfig { MinMs = 200, MaxMs = 500 },
        };

        var result = await new PythonScriptVerifier().VerifyAsync(new PythonApiCodeGenerator().Generate(plan));

        Assert.True(result.Success, result.Error);
        Assert.Equal(4, timed.Requests.Count);
        Assert.All(timed.Gaps(), gap => Assert.True(gap >= 180, $"gap {gap} ms < 200 ms minimum pause"));
    }

    [Fact]
    public async Task BrowserPagination_WaitsBetweenEveryNavigation()
    {
        using var timed = new TimedServer(_ => Html("<h1>Seite</h1>"));
        var plan = FlatPlan(timed.Server.BaseUrl, new RequestDelayConfig { MinMs = 400, MaxMs = 400 },
            new PageNumberPagination { UrlTemplate = "{url}?page={page}", MaxPages = 2 }, ScrapingEngine.Browser);

        var result = await new PythonScriptVerifier().VerifyAsync(new PythonPlaywrightCodeGenerator().Generate(plan));

        Assert.True(result.Success, result.Error);
        var pages = timed.Requests.Where(r => !r.PathAndQuery.Contains("favicon")).ToList();
        Assert.Equal(2, pages.Count);
        // The script measures the gap from the moment it *initiates* each
        // navigation; a freshly launched Chromium takes a few dozen ms longer
        // to actually send its very first request, which shortens the gap the
        // server observes by that much — hence a looser bound than the
        // requests-based tests above.
        Assert.True(pages[1].AtMs - pages[0].AtMs >= 300, $"gap {pages[1].AtMs - pages[0].AtMs} ms is far below the 400 ms pause");
    }

    // ── Trial-run verifier: announced pauses never count against the timeout ─

    [Fact]
    public async Task Verifier_ExtendsItsDeadlineByAnnouncedPauses()
    {
        // 4 pages × 1.5 s pause = 4.5 s of pure waiting — far beyond this
        // verifier's own 2 s timeout, yet the run must succeed.
        using var timed = new TimedServer(_ => Html("<h1>Seite</h1>"));
        var plan = FlatPlan(timed.Server.BaseUrl, new RequestDelayConfig { MinMs = 1500, MaxMs = 1500 },
            new PageNumberPagination { UrlTemplate = "{url}?page={page}", MaxPages = 4 });

        var result = await new PythonScriptVerifier(timeout: TimeSpan.FromSeconds(2)).VerifyAsync(new PythonCodeGenerator().Generate(plan));

        Assert.True(result.Success, result.Error);
        Assert.Equal(4, timed.Requests.Count);
    }

    [Fact]
    public async Task Verifier_StillTimesOutAScriptThatHangsWithoutPausing()
    {
        const string script = "import time\nprint('Pausing 0.50 s before the next request (request delay)...', flush=True)\ntime.sleep(10)\n";

        var result = await new PythonScriptVerifier(timeout: TimeSpan.FromSeconds(1)).VerifyAsync(script);

        Assert.False(result.Success);
        Assert.Contains("exceeded the 1s timeout (not counting 0.5s of request-delay pauses)", result.Error);
    }
}
