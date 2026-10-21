using System.Collections.Concurrent;
using System.Net;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #321: API-mode pagination by the HTTP `Link: <...>; rel="next"`
// response header — structural validation plus real runs of the generated
// script against a local server that announces the next page only there.
public class ApiLinkHeaderPaginationTests
{
    // ── Validation ────────────────────────────────────────────────────────

    private static ApiConfig Api(ApiLinkHeaderPagination? link, string method = "GET", ApiCursorPagination? cursor = null,
        EmbeddedJsonSource? embedded = null, string urlTemplate = "https://example.com/api/items") => new()
    {
        Method = method,
        UrlTemplate = urlTemplate,
        ItemsPath = "items",
        Fields = [new ApiField { Name = "Title", Path = "title" }],
        Body = method == "POST" ? new ApiBodyObject { Properties = [] } : null,
        EmbeddedJsonSource = embedded,
        CursorPagination = cursor,
        LinkHeaderPagination = link,
    };

    private static PlanValidationResult Validate(ApiConfig api) => ScrapingPlanValidator.Validate(new ScrapingPlan
    {
        Engine = ScrapingEngine.Api,
        Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
    });

    [Fact]
    public void Default_IsValid() => Assert.True(Validate(Api(new ApiLinkHeaderPagination())).Success);

    [Fact]
    public void NonPositiveMaxPages_IsRejected()
    {
        var result = Validate(Api(new ApiLinkHeaderPagination { MaxPages = 0 }));
        Assert.False(result.Success);
        Assert.Contains("MaxPages", result.Error);
    }

    [Fact]
    public void CombinedWithCursorPagination_IsRejected()
    {
        var cursor = new ApiCursorPagination { NextCursorPath = "next", QueryParameterName = "cursor" };
        var result = Validate(Api(new ApiLinkHeaderPagination(), cursor: cursor));
        Assert.False(result.Success);
        Assert.Contains("cursor pagination", result.Error);
    }

    [Fact]
    public void WithEmbeddedJsonSource_IsRejected()
    {
        var result = Validate(Api(new ApiLinkHeaderPagination(), embedded: new EmbeddedJsonSource { ScriptSelector = "#data" }));
        Assert.False(result.Success);
        Assert.Contains("embedded JSON", result.Error);
    }

    [Fact]
    public void WithPost_IsRejected()
    {
        var result = Validate(Api(new ApiLinkHeaderPagination(), method: "POST"));
        Assert.False(result.Success);
        Assert.Contains("GET", result.Error);
    }

    [Fact]
    public void WireFormat_RoundTripsAndDefaultsToFiftyPages()
    {
        var config = System.Text.Json.JsonSerializer.Deserialize<ScrapingConfig>(
            """{"url":"https://example.com","api":{"urlTemplate":"https://example.com/a","itemsPath":"i","fields":[{"name":"T","path":"t"}],"linkHeaderPagination":{}}}""",
            new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
        Assert.Equal(50, config!.Api!.LinkHeaderPagination!.MaxPages);
    }

    // ── Real runs ─────────────────────────────────────────────────────────

    private static Task<ScriptVerificationResult> Verify(ApiConfig api, OutputFormat format = OutputFormat.Csv) =>
        new PythonScriptVerifier().VerifyAsync(
            new PythonApiCodeGenerator().Generate(new ScrapingPlan
            {
                Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
                OutputFormat = format,
                Engine = ScrapingEngine.Api,
            }),
            outputFormat: format, extraTimeout: TimeSpan.FromSeconds(30), includeOutputFile: true);

    private static ApiConfig FlatApi(string urlTemplate, ApiLinkHeaderPagination link, List<ApiParameter>? parameters = null, List<ApiHeader>? headers = null) => new()
    {
        UrlTemplate = urlTemplate,
        ItemsPath = "items",
        Fields = [new ApiField { Name = "Title", Path = "title" }],
        Parameters = parameters ?? [],
        Headers = headers,
        LinkHeaderPagination = link,
    };

    private static string Page(params string[] titles) =>
        $$"""{ "items": [ {{string.Join(", ", titles.Select(t => $$"""{ "title": "{{t}}" }"""))}} ] }""";

    private static LocalTestServerResponse Json(string body, string? link = null) => new(
        body, "application/json", Headers: link is null ? null : new Dictionary<string, string> { ["Link"] = link });

    // /items?page=N, 3 pages; every page but the last announces the next one
    // (absolute URL, like GitHub). `prefix` distinguishes parameter combos.
    private static LocalTestServer ChainServer(int pages = 3, bool relative = false) => new(request =>
    {
        var page = int.Parse(request.QueryString["page"] ?? "1");
        var category = request.QueryString["category"] ?? "x";
        var title = $"{category}-{page}";
        if (page >= pages)
            return Json(Page(title));
        var next = $"/items?category={category}&page={page + 1}";
        var target = relative ? next : request.Url!.GetLeftPart(UriPartial.Authority) + next;
        return Json(Page(title), $"<{target}>; rel=\"next\", <{request.Url!.GetLeftPart(UriPartial.Authority)}/items?page=9>; rel=\"last\"");
    });

    [Fact]
    public async Task FollowsAbsoluteNextLinksUntilNoneIsLeft()
    {
        using var server = ChainServer();
        var result = await Verify(FlatApi($"{server.BaseUrl}items", new ApiLinkHeaderPagination()));

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, result.RowCount);
        Assert.Contains("x-3", result.OutputFileContent);
    }

    [Fact]
    public async Task ResolvesARelativeNextLink()
    {
        using var server = ChainServer(relative: true);
        var result = await Verify(FlatApi($"{server.BaseUrl}items", new ApiLinkHeaderPagination()));

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, result.RowCount);
    }

    [Fact]
    public async Task EveryParameterCombination_RunsItsOwnChain()
    {
        using var server = ChainServer();
        var result = await Verify(FlatApi(
            $"{server.BaseUrl}items?category={{category}}", new ApiLinkHeaderPagination(),
            [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["p", "q"] } }]));

        Assert.True(result.Success, result.Error);
        Assert.Equal(6, result.RowCount);
        Assert.Contains("p-3", result.OutputFileContent);
        Assert.Contains("q-1", result.OutputFileContent);
    }

    [Fact]
    public async Task MaxPages_CapsTheChain()
    {
        using var server = ChainServer(pages: 100);
        var result = await Verify(FlatApi($"{server.BaseUrl}items", new ApiLinkHeaderPagination { MaxPages = 4 }));

        Assert.True(result.Success, result.Error);
        Assert.Equal(4, result.RowCount);
    }

    // Page 1 is never altered, and the next pages carry the request headers.
    [Fact]
    public async Task FurtherPages_KeepTheConfiguredHeaders()
    {
        var keys = new ConcurrentBag<string?>();
        using var server = new LocalTestServer(request =>
        {
            keys.Add(request.Headers["X-Key"]);
            var page = int.Parse(request.QueryString["page"] ?? "1");
            return page >= 3
                ? Json(Page($"t{page}"))
                : Json(Page($"t{page}"), $"</items?page={page + 1}>; rel=\"next\"");
        });
        var headers = new List<ApiHeader> { new() { Name = "X-Key", Value = "secret" } };

        var result = await Verify(FlatApi($"{server.BaseUrl}items", new ApiLinkHeaderPagination(), headers: headers));

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, keys.Count);
        Assert.All(keys, key => Assert.Equal("secret", key));
    }

    [Fact]
    public async Task RepeatedLink_StopsInsteadOfLoopingForever()
    {
        using var server = new LocalTestServer(_ => Json(Page("t"), "</items?page=2>; rel=\"next\""));
        var result = await Verify(FlatApi($"{server.BaseUrl}items", new ApiLinkHeaderPagination()));

        Assert.True(result.Success, result.Error);
        // page 1 (as configured) + page 2 — then the link repeats.
        Assert.Equal(2, result.RowCount);
    }

    // A link to another host must never be requested — the request's own
    // headers (often credentials) would travel there.
    [Fact]
    public async Task LinkToAnotherHost_IsNotFollowed()
    {
        var requests = 0;
        using var server = new LocalTestServer(request =>
        {
            Interlocked.Increment(ref requests);
            var port = request.Url!.Port;
            return Json(Page("t"), $"<http://localhost:{port}/items?page=2>; rel=\"next\"");
        });
        // The configured host is 127.0.0.1 — "localhost" is a different origin.
        var result = await Verify(FlatApi($"{server.BaseUrl}items", new ApiLinkHeaderPagination()));

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, result.RowCount);
        Assert.Equal(1, requests);
    }

    [Fact]
    public async Task A404OnALaterPage_EndsTheChain()
    {
        using var server = new LocalTestServer(request => request.QueryString["page"] is null
            ? Json(Page("first"), "</items?page=2>; rel=\"next\"")
            : new LocalTestServerResponse("{}", "application/json", HttpStatusCode.NotFound));
        var result = await Verify(FlatApi($"{server.BaseUrl}items", new ApiLinkHeaderPagination()));

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, result.RowCount);
    }

    [Fact]
    public async Task NoLinkHeader_MeansASingleRequest()
    {
        var requests = 0;
        using var server = new LocalTestServer(_ =>
        {
            Interlocked.Increment(ref requests);
            return Json(Page("only"));
        });
        var result = await Verify(FlatApi($"{server.BaseUrl}items", new ApiLinkHeaderPagination()));

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, requests);
    }

    [Fact]
    public async Task TreeShape_CollectsEveryPageUnderOneRoot()
    {
        using var server = ChainServer();
        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}items",
            Groups = [new ApiGroup { Name = "Item", Path = "items", Children = [new ApiField { Name = "Title", Path = "title" }] }],
            LinkHeaderPagination = new ApiLinkHeaderPagination(),
        };

        var result = await Verify(api, OutputFormat.Xml);

        Assert.True(result.Success, result.Error);
        Assert.Contains("x-1", result.OutputFileContent);
        Assert.Contains("x-3", result.OutputFileContent);
    }
}
