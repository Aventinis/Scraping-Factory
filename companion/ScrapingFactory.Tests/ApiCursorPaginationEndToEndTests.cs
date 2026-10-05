using System.Net;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #224: real end-to-end proof that the generated Api-mode script
// follows a cursor chain — each page's response is the only place the next
// cursor is revealed, so a script that ignored it could never get past page 1.
public class ApiCursorPaginationEndToEndTests
{
    private static ScrapingPlan PlanWith(ApiConfig api, OutputFormat outputFormat) => new()
    {
        Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
        OutputFormat = outputFormat,
        Engine = ScrapingEngine.Api,
    };

    private static Task<ScriptVerificationResult> Verify(ApiConfig api, OutputFormat outputFormat = OutputFormat.Csv) =>
        new PythonScriptVerifier().VerifyAsync(
            new PythonApiCodeGenerator().Generate(PlanWith(api, outputFormat)),
            outputFormat: outputFormat, extraTimeout: TimeSpan.FromSeconds(30), includeOutputFile: true);

    private static string Page(string cursorJson, bool? hasNext, params string[] titles) =>
        $$"""{ "data": { "items": [ {{string.Join(", ", titles.Select(t => $$"""{ "title": "{{t}}" }"""))}} ] }, "next": {{cursorJson}}{{(hasNext is { } h ? $$""", "hasNext": {{(h ? "true" : "false")}}""" : "")}} }""";

    // ?cursor absent → a1,a2 (next c2); c2 → a3,a4 (next c3); c3 → a5 (no next).
    // A "category" prefix keeps parameter combinations' chains distinguishable.
    private static LocalTestServer QueryServer() => new(request =>
    {
        var category = request.QueryString["category"] ?? "x";
        var page = request.QueryString["cursor"] switch
        {
            null => Page("\"c2\"", null, $"{category}-1", $"{category}-2"),
            "c2" => Page("\"c3\"", null, $"{category}-3", $"{category}-4"),
            "c3" => Page("null", null, $"{category}-5"),
            _ => "{}",
        };
        return new LocalTestServerResponse(page, "application/json");
    });

    private static ApiConfig FlatApi(string urlTemplate, ApiCursorPagination cursor, List<ApiParameter>? parameters = null,
        string method = "GET", ApiBodyNode? body = null) => new()
    {
        Method = method,
        UrlTemplate = urlTemplate,
        ItemsPath = "data.items",
        Fields = [new ApiField { Name = "Title", Path = "title" }],
        Parameters = parameters ?? [],
        Body = body,
        CursorPagination = cursor,
    };

    private static ApiCursorPagination QueryCursor(int maxPages = 50, string? hasNextPagePath = null) => new()
    {
        NextCursorPath = "next",
        HasNextPagePath = hasNextPagePath,
        QueryParameterName = "cursor",
        MaxPages = maxPages,
    };

    [Fact]
    public async Task QueryTarget_FollowsCursorChainUntilNoCursor()
    {
        using var server = QueryServer();
        var result = await Verify(FlatApi($"{server.BaseUrl}items", QueryCursor()));

        Assert.True(result.Success, result.Error);
        Assert.Equal(5, result.RowCount);
        Assert.Contains("x-5", result.OutputFileContent);
    }

    [Fact]
    public async Task QueryTarget_KeepsExistingQueryParametersUntouched()
    {
        using var server = QueryServer();
        var result = await Verify(FlatApi(
            $"{server.BaseUrl}items?category={{category}}", QueryCursor(),
            [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a b"] } }]));

        Assert.True(result.Success, result.Error);
        Assert.Equal(5, result.RowCount);
        Assert.Contains("a b-5", result.OutputFileContent);
    }

    // Each parameter combination runs its own independent chain.
    [Fact]
    public async Task EveryParameterCombination_RunsItsOwnChain()
    {
        using var server = QueryServer();
        var result = await Verify(FlatApi(
            $"{server.BaseUrl}items?category={{category}}", QueryCursor(),
            [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["p", "q"] } }]));

        Assert.True(result.Success, result.Error);
        Assert.Equal(10, result.RowCount);
        Assert.Contains("p-5", result.OutputFileContent);
        Assert.Contains("q-1", result.OutputFileContent);
    }

    [Fact]
    public async Task MaxPages_CapsTheChain()
    {
        // Always hands out a fresh cursor — only the cap ends it.
        var counter = 0;
        using var server = new LocalTestServer(_ =>
        {
            var n = Interlocked.Increment(ref counter);
            return new LocalTestServerResponse(Page($"\"c{n}\"", null, $"t{n}"), "application/json");
        });

        var result = await Verify(FlatApi($"{server.BaseUrl}items", QueryCursor(maxPages: 3)));

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, result.RowCount);
        Assert.Equal(3, counter);
    }

    [Fact]
    public async Task RepeatedCursor_StopsInsteadOfLoopingForever()
    {
        using var server = new LocalTestServer(_ => new LocalTestServerResponse(Page("\"same\"", null, "t"), "application/json"));

        var result = await Verify(FlatApi($"{server.BaseUrl}items", QueryCursor()));

        Assert.True(result.Success, result.Error);
        // page 1 (no cursor) + page 2 (cursor "same") — then "same" repeats.
        Assert.Equal(2, result.RowCount);
    }

    [Fact]
    public async Task HasNextPageFalse_StopsEvenThoughACursorIsPresent()
    {
        using var server = new LocalTestServer(request => new LocalTestServerResponse(
            request.QueryString["cursor"] is null
                ? Page("\"c2\"", true, "first")
                : Page("\"c2\"", false, "last"),
            "application/json"));

        var result = await Verify(FlatApi($"{server.BaseUrl}items", QueryCursor(hasNextPagePath: "hasNext")));

        Assert.True(result.Success, result.Error);
        Assert.Equal(2, result.RowCount);
        Assert.Contains("last", result.OutputFileContent);
    }

    // GraphQL/Relay style: POST body with the cursor at variables.after.
    [Fact]
    public async Task BodyTarget_SetsCursorInsideTheJsonBody()
    {
        using var server = new LocalTestServer(request =>
        {
            using var reader = new StreamReader(request.InputStream, request.ContentEncoding);
            var body = reader.ReadToEnd();
            var page = body.Contains("\"after\": \"c2\"") || body.Contains("\"after\":\"c2\"")
                ? Page("\"c3\"", false, "second")
                : body.Contains("\"after\"")
                    ? "{}"
                    : Page("\"c2\"", true, "first");
            return new LocalTestServerResponse(page, "application/json");
        });
        var body = new ApiBodyObject
        {
            Properties = new()
            {
                ["query"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.String, StringValue = "{ items }" },
                ["variables"] = new ApiBodyObject
                {
                    Properties = new() { ["first"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.Number, NumberValue = 2 } },
                },
            },
        };
        var cursor = new ApiCursorPagination
        {
            NextCursorPath = "next", HasNextPagePath = "hasNext", Target = ApiCursorTarget.Body, BodyPath = "variables.after",
        };

        var result = await Verify(FlatApi($"{server.BaseUrl}graphql", cursor, method: "POST", body: body));

        Assert.True(result.Success, result.Error);
        Assert.Equal(2, result.RowCount);
        Assert.Contains("second", result.OutputFileContent);
    }

    [Fact]
    public async Task TreeShape_CollectsEveryPageUnderOneRoot()
    {
        using var server = QueryServer();
        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}items",
            Groups = [new ApiGroup { Name = "Item", Path = "data.items", Children = [new ApiField { Name = "Title", Path = "title" }] }],
            CursorPagination = QueryCursor(),
        };

        var result = await Verify(api, OutputFormat.Xml);

        Assert.True(result.Success, result.Error);
        Assert.Contains("x-1", result.OutputFileContent);
        Assert.Contains("x-5", result.OutputFileContent);
    }

    [Fact]
    public async Task NotFoundOnALaterPage_EndsTheChainQuietly()
    {
        using var server = new LocalTestServer(request => request.QueryString["cursor"] is null
            ? new LocalTestServerResponse(Page("\"c2\"", null, "only"), "application/json")
            : new LocalTestServerResponse("{}", "application/json", HttpStatusCode.NotFound));

        var result = await Verify(FlatApi($"{server.BaseUrl}items", QueryCursor()));

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, result.RowCount);
    }
}
