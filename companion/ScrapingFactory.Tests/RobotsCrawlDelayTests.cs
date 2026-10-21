using System.Collections.Concurrent;
using System.Diagnostics;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #228: the generated script reads Crawl-delay / Request-rate from the
// target's robots.txt and uses it as a minimum gap between requests — rendered
// script shape, and real runs measuring the gaps a LocalTestServer actually
// sees for both engines and API mode.
public class RobotsCrawlDelayTests
{
    private static ScrapingPlan FlatPlan(string url, bool respect, RequestDelayConfig? delay = null, ScrapingEngine engine = ScrapingEngine.Static) => new()
    {
        Steps = [new NavigateStep { Urls = [url] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
        RespectRobotsDelay = respect,
        RequestDelay = delay,
        Pagination = new PageNumberPagination { UrlTemplate = "{url}?page={page}", MaxPages = 3 },
        Engine = engine,
    };

    [Fact]
    public void GeneratedScript_WithoutTheOption_HasNoRobotsHandling()
    {
        var script = new PythonCodeGenerator().Generate(FlatPlan("https://example.com", respect: false));
        Assert.DoesNotContain("robots", script, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("_pace_request", script);
    }

    [Fact]
    public void GeneratedScript_WithTheOptionAlone_PacesWithAZeroBasePause()
    {
        var script = new PythonCodeGenerator().Generate(FlatPlan("https://example.com/list", respect: true));
        Assert.Contains("def _robots_delay():", script);
        Assert.Contains("ROBOTS_URLS = [", script);
        Assert.Contains("https://example.com/list", script);
        Assert.Contains("REQUEST_DELAY_MIN_S = 0.0", script);
        Assert.DoesNotContain("ProxyHandler", script);
    }

    [Fact]
    public void GeneratedScript_WithProxy_FetchesRobotsTxtThroughIt()
    {
        var plan = FlatPlan("https://example.com", respect: true);
        var withProxy = new ScrapingPlan
        {
            Steps = plan.Steps, Pagination = plan.Pagination, RespectRobotsDelay = true,
            Proxy = new ProxyConfig { EnvironmentVariableName = "MY_PROXIES" },
        };
        var script = new PythonCodeGenerator().Generate(withProxy);
        Assert.Contains("urllib.request.ProxyHandler", script);
    }

    // ── Real runs ────────────────────────────────────────────────────────────

    private sealed class RobotsServer : IDisposable
    {
        private readonly Stopwatch _clock = Stopwatch.StartNew();
        private readonly ConcurrentQueue<(string Path, long AtMs)> _requests = new();
        public LocalTestServer Server { get; }

        // robotsTxt == null → robots.txt answers 404.
        public RobotsServer(string? robotsTxt)
        {
            Server = new LocalTestServer(request =>
            {
                var path = request.Url!.AbsolutePath;
                _requests.Enqueue((path, _clock.ElapsedMilliseconds));
                if (path == "/robots.txt")
                    return robotsTxt is null
                        ? new LocalTestServerResponse("not found", "text/plain", System.Net.HttpStatusCode.NotFound)
                        : new LocalTestServerResponse(robotsTxt, "text/plain; charset=utf-8");
                return new LocalTestServerResponse("<html><body><h1>Seite</h1></body></html>", "text/html; charset=utf-8");
            });
        }

        public int RobotsFetches => _requests.Count(r => r.Path == "/robots.txt");
        public int PageRequests => _requests.Count(r => r.Path != "/robots.txt");

        public List<long> PageGaps()
        {
            var times = _requests.Where(r => r.Path != "/robots.txt").Select(r => r.AtMs).ToList();
            return times.Zip(times.Skip(1), (a, b) => b - a).ToList();
        }

        public void Dispose() => Server.Dispose();
    }

    [Fact]
    public async Task CrawlDelay_IsHonoredBetweenPages_AndRobotsTxtIsReadOnce()
    {
        using var robots = new RobotsServer("User-agent: *\nCrawl-delay: 1\n");
        var plan = FlatPlan(robots.Server.BaseUrl, respect: true);

        var result = await new PythonScriptVerifier().VerifyAsync(new PythonCodeGenerator().Generate(plan));

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, robots.PageRequests);
        Assert.Equal(1, robots.RobotsFetches);
        Assert.All(robots.PageGaps(), gap => Assert.True(gap >= 850, $"gap {gap} ms < the 1000 ms Crawl-delay"));
    }

    [Fact]
    public async Task RequestRate_IsHonored()
    {
        using var robots = new RobotsServer("User-agent: *\nRequest-rate: 1/1\n");
        var plan = FlatPlan(robots.Server.BaseUrl, respect: true);

        var result = await new PythonScriptVerifier().VerifyAsync(new PythonCodeGenerator().Generate(plan));

        Assert.True(result.Success, result.Error);
        Assert.All(robots.PageGaps(), gap => Assert.True(gap >= 850, $"gap {gap} ms < 1000 ms (Request-rate 1/1)"));
    }

    [Fact]
    public async Task TheLargerOfConfiguredPauseAndCrawlDelayWins()
    {
        using var robots = new RobotsServer("User-agent: *\nCrawl-delay: 1\n");
        var plan = FlatPlan(robots.Server.BaseUrl, respect: true, new RequestDelayConfig { MinMs = 1500, MaxMs = 1500 });

        var result = await new PythonScriptVerifier().VerifyAsync(new PythonCodeGenerator().Generate(plan));

        Assert.True(result.Success, result.Error);
        Assert.All(robots.PageGaps(), gap => Assert.True(gap >= 1350, $"gap {gap} ms < the 1500 ms configured pause"));
    }

    [Fact]
    public async Task NoDirective_IsANoOp()
    {
        using var robots = new RobotsServer("User-agent: *\nDisallow: /private\n");
        var plan = FlatPlan(robots.Server.BaseUrl, respect: true);

        var result = await new PythonScriptVerifier().VerifyAsync(new PythonCodeGenerator().Generate(plan));

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, robots.PageRequests);
        Assert.All(robots.PageGaps(), gap => Assert.True(gap < 900, $"gap {gap} ms although robots.txt asks for no delay"));
    }

    [Fact]
    public async Task MissingRobotsTxt_IsANoOp()
    {
        using var robots = new RobotsServer(null);
        var plan = FlatPlan(robots.Server.BaseUrl, respect: true);

        var result = await new PythonScriptVerifier().VerifyAsync(new PythonCodeGenerator().Generate(plan));

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, robots.PageRequests);
    }

    [Fact]
    public async Task BrowserEngine_HonorsTheCrawlDelayToo()
    {
        using var robots = new RobotsServer("User-agent: *\nCrawl-delay: 1\n");
        var plan = FlatPlan(robots.Server.BaseUrl, respect: true, engine: ScrapingEngine.Browser);

        var result = await new PythonScriptVerifier().VerifyAsync(new PythonPlaywrightCodeGenerator().Generate(plan));

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, robots.RobotsFetches);
        Assert.All(robots.PageGaps(), gap => Assert.True(gap >= 800, $"gap {gap} ms < the 1000 ms Crawl-delay"));
    }

    [Fact]
    public async Task ApiMode_HonorsTheCrawlDelayBetweenParameterCombinations()
    {
        using var api = new LocalTestServer(request =>
        {
            return request.Url!.AbsolutePath == "/robots.txt"
                ? new LocalTestServerResponse("User-agent: *\nCrawl-delay: 1\n", "text/plain")
                : new LocalTestServerResponse("""{ "items": [ { "title": "x" } ] }""", "application/json");
        });
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ApiCallStep
                {
                    Config = new ApiConfig
                    {
                        UrlTemplate = $"{api.BaseUrl}items?c={{c}}",
                        ItemsPath = "items",
                        Fields = [new ApiField { Name = "Titel", Path = "title" }],
                        Parameters = [new ApiParameter { Name = "c", Source = new StaticListSource { Values = ["a", "b", "c"] } }],
                    },
                },
            ],
            Engine = ScrapingEngine.Api,
            RespectRobotsDelay = true,
        };

        var started = Stopwatch.StartNew();
        var result = await new PythonScriptVerifier().VerifyAsync(new PythonApiCodeGenerator().Generate(plan));
        started.Stop();

        Assert.True(result.Success, result.Error);
        Assert.True(started.ElapsedMilliseconds >= 1900, $"3 requests with a 1 s Crawl-delay took only {started.ElapsedMilliseconds} ms");
    }
}
