using System.Net;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// These tests actually spawn python3 and run the generated API-Mode script —
// same "prove the real artifact works" philosophy as PythonScriptVerifierTests,
// just against a fake JSON API (LocalTestServer's request-aware responder
// overload) instead of canned HTML.
public class PythonApiScriptVerifierTests
{
    private static ScrapingPlan PlanWith(ApiConfig api) => new()
    {
        Steps = [new NavigateStep { Url = "https://example.com" }, new ApiCallStep { Config = api }],
        OutputFormat = OutputFormat.Csv,
        Engine = ScrapingEngine.Api,
    };

    private static string GenerateScript(ApiConfig api) => new PythonApiCodeGenerator().Generate(PlanWith(api));

    [Fact]
    public async Task StaticListParameter_FetchesOneCombinationPerValue_Succeeds()
    {
        using var server = new LocalTestServer(request =>
        {
            var category = request.QueryString["category"];
            var json = $$"""{ "data": { "items": [ { "title": "Item-{{category}}", "meta": { "price": 9 } } ] } }""";
            return new LocalTestServerResponse(json, "application/json");
        });

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?category={{category}}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }, new ApiField { Name = "Preis", Path = "meta.price" }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a", "b"] } }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.True(result.Success, result.Error);
        Assert.Equal(2, result.RowCount); // one row per category value
    }

    [Fact]
    public async Task DiscoverySourceParameter_ResolvesValuesFromASecondRequest_Succeeds()
    {
        // Two distinct, real HTTP requests against the same test server: one
        // to the discovery endpoint (?discover=1) to learn the category
        // values, one per discovered category to the main endpoint.
        using var server = new LocalTestServer(request =>
        {
            if (request.QueryString["discover"] == "1")
            {
                return new LocalTestServerResponse(
                    """{ "data": [ { "slug": "books" }, { "slug": "toys" } ] }""", "application/json");
            }

            var category = request.QueryString["category"];
            var json = $$"""{ "data": { "items": [ { "title": "Item-{{category}}" } ] } }""";
            return new LocalTestServerResponse(json, "application/json");
        });

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?category={{category}}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters =
            [
                new ApiParameter
                {
                    Name = "category",
                    Source = new DiscoverySource
                    {
                        UrlTemplate = $"{server.BaseUrl}?discover=1",
                        ItemsPath = "data",
                        ValuePath = "slug",
                    },
                },
            ],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.True(result.Success, result.Error);
        Assert.Equal(2, result.RowCount); // one row per discovered category
    }

    [Fact]
    public async Task NumberRangeParameter_ExpandsFromToInclusive_Succeeds()
    {
        using var server = new LocalTestServer(request =>
        {
            var page = request.QueryString["page"];
            var json = $$"""{ "items": [ { "title": "Page-{{page}}" } ] }""";
            return new LocalTestServerResponse(json, "application/json");
        });

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?page={{page}}",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "page", Source = new RangeSource { Type = RangeType.Number, From = "1", To = "3" } }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, result.RowCount); // pages 1, 2, 3
    }

    [Fact]
    public async Task IsoWeekRangeParameter_ExpandsInclusiveWeekRange_Succeeds()
    {
        using var server = new LocalTestServer(request =>
        {
            var week = request.QueryString["week"];
            var json = $$"""{ "items": [ { "title": "Week-{{week}}" } ] }""";
            return new LocalTestServerResponse(json, "application/json");
        });

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?week={{week}}",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            // 2026-W01 through 2026-W03 inclusive — 3 weeks.
            Parameters = [new ApiParameter { Name = "week", Source = new RangeSource { Type = RangeType.IsoWeek, From = "2026-W01", To = "2026-W03" } }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, result.RowCount);
    }

    [Fact]
    public async Task DateRangeParameter_ExpandsInclusiveDateRange_Succeeds()
    {
        using var server = new LocalTestServer(request =>
        {
            var date = request.QueryString["date"];
            var json = $$"""{ "items": [ { "title": "Date-{{date}}" } ] }""";
            return new LocalTestServerResponse(json, "application/json");
        });

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?date={{date}}",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            // 2026-01-01 through 2026-01-04 inclusive — 4 days.
            Parameters = [new ApiParameter { Name = "date", Source = new RangeSource { Type = RangeType.Date, From = "2026-01-01", To = "2026-01-04" } }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.True(result.Success, result.Error);
        Assert.Equal(4, result.RowCount);
    }

    [Fact]
    public async Task AuthHeaderFromEnvironmentVariable_IsSentAsRealHeader_Succeeds()
    {
        const string envVarName = "SF_TEST_API_TOKEN";
        using var server = new LocalTestServer(request =>
        {
            var authHeader = request.Headers["Authorization"];
            var json = authHeader == "Bearer secret-token"
                ? """{ "items": [ { "title": "Authorized" } ] }"""
                : """{ "items": [] }""";
            return new LocalTestServerResponse(json, "application/json");
        });

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?category={{category}}",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
            Headers = [new ApiHeader { Name = "Authorization", EnvironmentVariableName = envVarName }],
        };

        Environment.SetEnvironmentVariable(envVarName, "Bearer secret-token");
        try
        {
            var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));
            Assert.True(result.Success, result.Error);
            Assert.Equal(1, result.RowCount);
        }
        finally
        {
            Environment.SetEnvironmentVariable(envVarName, null);
        }
    }

    [Fact]
    public async Task ItemsPathMatchingNothing_FailsWithZeroDataRows()
    {
        using var server = new LocalTestServer(_ =>
            new LocalTestServerResponse("""{ "items": [] }""", "application/json"));

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?category={{category}}",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.False(result.Success);
        Assert.Contains("keine Daten", result.Error);
        Assert.Equal(0, result.RowCount);
    }

    [Fact]
    public async Task PageReturning500_FailsWithScriptErrorOutput()
    {
        using var server = new LocalTestServer(_ =>
            new LocalTestServerResponse("server error", "text/plain", HttpStatusCode.InternalServerError));

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?category={{category}}",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.False(result.Success);
        Assert.NotNull(result.Error);
    }
}
