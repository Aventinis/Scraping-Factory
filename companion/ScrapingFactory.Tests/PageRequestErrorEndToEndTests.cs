using System.Net;
using System.Net.Sockets;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #319: a failed page request in flat/container/Blocks mode (Static and
// Browser engine) used to die with a raw requests/Playwright traceback that
// /generate then showed verbatim. These tests pin the error text the user
// actually sees now — PythonScriptVerifier's own result, the same string
// /generate returns — mirroring ApiRequestErrorEndToEndTests for the API
// templates (Issue #220 follow-up).
public class PageRequestErrorEndToEndTests
{
    private const string Html = "<html><body><h1>Titel</h1><div class='item'><span class='n'>A</span></div></body></html>";

    private static ScrapingPlan Plan(string url, ScrapingEngine engine = ScrapingEngine.Static, RetryConfig? retry = null,
        PaginationConfig? pagination = null, bool preflight = false, DiscoveredUrlsConfig? discovered = null) => new()
    {
        Steps = [new NavigateStep { Urls = [url] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
        Engine = engine,
        Retry = retry,
        Pagination = pagination,
        Preflight = preflight,
        DiscoveredUrls = discovered,
    };

    private static ScrapingPlan GroupPlan(string url, ScrapingEngine engine = ScrapingEngine.Static) => new()
    {
        Steps =
        [
            new NavigateStep { Urls = [url] },
            new ExtractGroupStep
            {
                Roots =
                [
                    new GroupNode
                    {
                        Name = "Eintrag", Selector = ".item", Repeating = true,
                        Children = [new DataFieldNode { Name = "Name", Selector = ".n", Mode = ExtractMode.Text }],
                    },
                ],
            },
        ],
        OutputFormat = OutputFormat.Xml,
        Engine = engine,
    };

    private static ScrapingPlan BlocksPlan(string url, ScrapingEngine engine = ScrapingEngine.Static) => new()
    {
        Steps =
        [
            new NavigateStep { Urls = [url] },
            new ExtractionBlockStep
            {
                Blocks =
                [
                    new PlanExtractionBlock { Name = "a", OutputFormat = OutputFormat.Csv, OutputFileBaseName = "a", Fields = [new ExtractStep { Name = "Titel", Selector = "h1" }] },
                    new PlanExtractionBlock { Name = "b", OutputFormat = OutputFormat.Csv, OutputFileBaseName = "b", Fields = [new ExtractStep { Name = "Titel", Selector = "h1" }] },
                ],
            },
        ],
        Engine = engine,
    };

    private static string Generate(ScrapingPlan plan) => plan.Engine == ScrapingEngine.Browser
        ? new PythonPlaywrightCodeGenerator().Generate(plan)
        : new PythonCodeGenerator().Generate(plan);

    private static Task<ScriptVerificationResult> Verify(ScrapingPlan plan, OutputFormat format = OutputFormat.Csv) =>
        new PythonScriptVerifier().VerifyAsync(Generate(plan), outputFormat: format, extraTimeout: TimeSpan.FromSeconds(60));

    private static void AssertCleanError(ScriptVerificationResult result)
    {
        Assert.False(result.Success);
        Assert.DoesNotContain("Traceback", result.Error);
        Assert.DoesNotContain("exited with an error", result.Error);
        Assert.DoesNotContain("ERROR: ", result.Error);
    }

    private static LocalTestServer StatusServer(HttpStatusCode status) => new(Html, status);

    private static string UnusedUrl()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop(); // nothing listens here any more
        return $"http://127.0.0.1:{port}/";
    }

    [Fact]
    public async Task Static_Flat_ServiceUnavailable_IsOneActionableLine()
    {
        using var server = StatusServer(HttpStatusCode.ServiceUnavailable);

        var result = await Verify(Plan(server.BaseUrl));

        AssertCleanError(result);
        Assert.StartsWith($"Request to {server.BaseUrl} failed: HTTP 503.", result.Error);
        Assert.Contains("usually temporary", result.Error);
        Assert.Contains("Retry on transient errors", result.Error);
    }

    [Theory]
    [InlineData(HttpStatusCode.Forbidden, "HTTP 403 (Forbidden)", "login")]
    [InlineData(HttpStatusCode.Unauthorized, "HTTP 401 (Unauthorized)", "login")]
    [InlineData(HttpStatusCode.NotFound, "HTTP 404 (Not Found)", "start URL")]
    [InlineData((HttpStatusCode)429, "HTTP 429 (Too Many Requests)", "Pause between requests")]
    public async Task Static_Flat_ClientErrors_ExplainWhatToDo(HttpStatusCode status, string expected, string hint)
    {
        using var server = StatusServer(status);

        var result = await Verify(Plan(server.BaseUrl));

        AssertCleanError(result);
        Assert.Contains(expected, result.Error);
        Assert.Contains(hint, result.Error);
    }

    [Fact]
    public async Task Static_Flat_UnreachableHost_SaysTheSiteCouldNotBeReached()
    {
        var result = await Verify(Plan(UnusedUrl()));

        AssertCleanError(result);
        Assert.Contains("could not reach the site (ConnectionError)", result.Error);
    }

    [Fact]
    public async Task Static_Container_ServiceUnavailable_IsOneActionableLine()
    {
        using var server = StatusServer(HttpStatusCode.ServiceUnavailable);

        var result = await Verify(GroupPlan(server.BaseUrl), OutputFormat.Xml);

        AssertCleanError(result);
        Assert.StartsWith($"Request to {server.BaseUrl} failed: HTTP 503.", result.Error);
    }

    [Fact]
    public async Task Static_Blocks_Forbidden_IsOneActionableLine()
    {
        using var server = StatusServer(HttpStatusCode.Forbidden);

        var result = await new PythonScriptVerifier().VerifyBlocksAsync(
            Generate(BlocksPlan(server.BaseUrl)),
            [new BlockOutputSpec("a", OutputFormat.Csv, "a"), new BlockOutputSpec("b", OutputFormat.Csv, "b")],
            extraTimeout: TimeSpan.FromSeconds(60));

        AssertCleanError(result);
        Assert.Contains("HTTP 403 (Forbidden)", result.Error);
    }

    // Once every retry is exhausted, the last response is reported exactly
    // like without retries (Issue #223 + #319).
    [Fact]
    public async Task Static_Flat_WithRetry_ReportsTheErrorOnceRetriesAreExhausted()
    {
        using var server = StatusServer(HttpStatusCode.ServiceUnavailable);

        var result = await Verify(Plan(server.BaseUrl, retry: new RetryConfig { MaxAttempts = 2, DelayMs = 0 }));

        AssertCleanError(result);
        Assert.Contains("HTTP 503", result.Error);
    }

    [Fact]
    public async Task Static_Flat_SecondPaginationPageFailing_NamesThatPage()
    {
        using var server = new LocalTestServer(request => request.Url!.AbsolutePath == "/p2"
            ? new LocalTestServerResponse(Html, "text/html", HttpStatusCode.ServiceUnavailable)
            : new LocalTestServerResponse(Html, "text/html"));
        var pagination = new PageNumberPagination { UrlTemplate = server.BaseUrl + "p{page}", MaxPages = 5 };

        var result = await Verify(Plan(server.BaseUrl, pagination: pagination));

        AssertCleanError(result);
        Assert.Contains($"{server.BaseUrl}p2 failed: HTTP 503", result.Error);
    }

    // Preflight deliberately keeps its own semantics (exit code 5, "target is
    // unreachable"), but must stay a clean one-liner too.
    [Fact]
    public async Task Static_Preflight_UnreachableTarget_IsStillAClearMessage()
    {
        using var server = StatusServer(HttpStatusCode.ServiceUnavailable);

        var result = await Verify(Plan(server.BaseUrl, preflight: true));

        AssertCleanError(result);
        Assert.Contains("Preflight check failed — target is unreachable", result.Error);
    }

    // A failing discovery page only degrades to a warning — the main run goes on.
    [Fact]
    public async Task Static_DiscoveredUrls_FailingOverviewPage_DoesNotStopTheMainRun()
    {
        using var server = new LocalTestServer(request => request.Url!.AbsolutePath == "/nav"
            ? new LocalTestServerResponse(Html, "text/html", HttpStatusCode.ServiceUnavailable)
            : new LocalTestServerResponse(Html, "text/html"));
        var discovered = new DiscoveredUrlsConfig { PageUrl = server.BaseUrl + "nav", LinkSelector = "a" };

        var result = await Verify(Plan(server.BaseUrl, discovered: discovered));

        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public async Task Browser_Flat_ServiceUnavailable_IsOneActionableLine()
    {
        using var server = StatusServer(HttpStatusCode.ServiceUnavailable);

        var result = await Verify(Plan(server.BaseUrl, ScrapingEngine.Browser));

        AssertCleanError(result);
        Assert.StartsWith($"Navigation to {server.BaseUrl} failed: HTTP 503.", result.Error);
    }

    [Fact]
    public async Task Browser_Flat_UnreachableHost_NamesTheNetworkError()
    {
        var result = await Verify(Plan(UnusedUrl(), ScrapingEngine.Browser));

        AssertCleanError(result);
        Assert.Contains("could not load the page", result.Error);
        Assert.Contains("ERR_CONNECTION_REFUSED", result.Error);
    }

    [Fact]
    public async Task Browser_Container_Forbidden_IsOneActionableLine()
    {
        using var server = StatusServer(HttpStatusCode.Forbidden);

        var result = await Verify(GroupPlan(server.BaseUrl, ScrapingEngine.Browser), OutputFormat.Xml);

        AssertCleanError(result);
        Assert.Contains("HTTP 403 (Forbidden)", result.Error);
    }

    [Fact]
    public async Task Browser_Blocks_ServiceUnavailable_IsOneActionableLine()
    {
        using var server = StatusServer(HttpStatusCode.ServiceUnavailable);

        var result = await new PythonScriptVerifier().VerifyBlocksAsync(
            Generate(BlocksPlan(server.BaseUrl, ScrapingEngine.Browser)),
            [new BlockOutputSpec("a", OutputFormat.Csv, "a"), new BlockOutputSpec("b", OutputFormat.Csv, "b")],
            extraTimeout: TimeSpan.FromSeconds(60));

        AssertCleanError(result);
        Assert.Contains("Navigation to", result.Error);
        Assert.Contains("HTTP 503", result.Error);
    }

    [Fact]
    public async Task Browser_Flat_SecondPaginationPageFailing_NamesThatPage()
    {
        using var server = new LocalTestServer(request => request.Url!.AbsolutePath == "/p2"
            ? new LocalTestServerResponse(Html, "text/html", HttpStatusCode.ServiceUnavailable)
            : new LocalTestServerResponse(Html, "text/html"));
        var pagination = new PageNumberPagination { UrlTemplate = server.BaseUrl + "p{page}", MaxPages = 5 };

        var result = await Verify(Plan(server.BaseUrl, ScrapingEngine.Browser, pagination: pagination));

        AssertCleanError(result);
        Assert.Contains($"{server.BaseUrl}p2 failed: HTTP 503", result.Error);
    }

    [Fact]
    public async Task Static_And_Browser_HealthyPage_StillWorks()
    {
        using var server = new LocalTestServer(Html);

        var staticResult = await Verify(Plan(server.BaseUrl));
        var browserResult = await Verify(Plan(server.BaseUrl, ScrapingEngine.Browser));

        Assert.True(staticResult.Success, staticResult.Error);
        Assert.True(browserResult.Success, browserResult.Error);
    }
}
