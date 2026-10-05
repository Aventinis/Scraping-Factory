using System.Text.Json;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #224: structural validation of ApiConfig.CursorPagination.
public class ApiCursorPaginationValidatorTests
{
    private static ApiCursorPagination ValidQuery() => new() { NextCursorPath = "next", QueryParameterName = "cursor" };

    private static ApiConfig Api(ApiCursorPagination? cursor, string method = "GET", ApiBodyNode? body = null, EmbeddedJsonSource? embedded = null) => new()
    {
        Method = method,
        UrlTemplate = "https://example.com/api/items",
        ItemsPath = "data.items",
        Fields = [new ApiField { Name = "Titel", Path = "title" }],
        Body = body,
        EmbeddedJsonSource = embedded,
        CursorPagination = cursor,
    };

    private static PlanValidationResult Validate(ApiConfig api) => ScrapingPlanValidator.Validate(new ScrapingPlan
    {
        Engine = ScrapingEngine.Api,
        Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
    });

    private static readonly ApiBodyNode EmptyBody = new ApiBodyObject { Properties = [] };

    [Fact]
    public void ValidQueryTarget_Succeeds() => Assert.True(Validate(Api(ValidQuery())).Success);

    [Fact]
    public void ValidBodyTarget_Succeeds()
    {
        var cursor = new ApiCursorPagination { NextCursorPath = "a.b", Target = ApiCursorTarget.Body, BodyPath = "variables.after", HasNextPagePath = "a.more" };
        Assert.True(Validate(Api(cursor, "POST", EmptyBody)).Success);
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    public void BlankNextCursorPath_IsRejected(string path)
    {
        var result = Validate(Api(new ApiCursorPagination { NextCursorPath = path, QueryParameterName = "cursor" }));
        Assert.False(result.Success);
        Assert.Contains("NextCursorPath", result.Error);
    }

    [Fact]
    public void BlankHasNextPagePath_IsRejected()
    {
        var result = Validate(Api(new ApiCursorPagination { NextCursorPath = "next", QueryParameterName = "cursor", HasNextPagePath = " " }));
        Assert.False(result.Success);
        Assert.Contains("HasNextPagePath", result.Error);
    }

    [Fact]
    public void NonPositiveMaxPages_IsRejected()
    {
        var result = Validate(Api(new ApiCursorPagination { NextCursorPath = "next", QueryParameterName = "cursor", MaxPages = 0 }));
        Assert.False(result.Success);
        Assert.Contains("MaxPages", result.Error);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("a b")]
    [InlineData("a&b")]
    [InlineData("a=b")]
    public void QueryTarget_NeedsAUsableParameterName(string? name)
    {
        var result = Validate(Api(new ApiCursorPagination { NextCursorPath = "next", QueryParameterName = name }));
        Assert.False(result.Success);
        Assert.Contains("QueryParameterName", result.Error + " " + result.Error?.Replace("query parameter name", "QueryParameterName"));
    }

    [Fact]
    public void BodyTarget_RequiresPostWithBody()
    {
        var cursor = new ApiCursorPagination { NextCursorPath = "next", Target = ApiCursorTarget.Body, BodyPath = "after" };
        Assert.Contains("POST", Validate(Api(cursor)).Error);
        Assert.Contains("POST", Validate(Api(cursor, "POST")).Error);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("a..b")]
    [InlineData("a[0].b")]
    public void BodyTarget_NeedsAValidBodyPath(string? path)
    {
        var cursor = new ApiCursorPagination { NextCursorPath = "next", Target = ApiCursorTarget.Body, BodyPath = path };
        var result = Validate(Api(cursor, "POST", EmptyBody));
        Assert.False(result.Success);
        Assert.Contains("BodyPath", result.Error);
    }

    [Fact]
    public void EmbeddedJsonSource_IsRejected()
    {
        var result = Validate(Api(ValidQuery(), embedded: new EmbeddedJsonSource { ScriptSelector = "#data" }));
        Assert.False(result.Success);
        Assert.Contains("embedded JSON", result.Error);
    }

    [Fact]
    public void WireFormat_DeserializesCamelCaseWithStringEnum()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
        };
        var cursor = JsonSerializer.Deserialize<ApiCursorPagination>(
            """{ "nextCursorPath": "pageInfo.endCursor", "hasNextPagePath": "pageInfo.hasNextPage", "target": "body", "bodyPath": "variables.after", "maxPages": 7 }""", options)!;

        Assert.Equal("pageInfo.endCursor", cursor.NextCursorPath);
        Assert.Equal(ApiCursorTarget.Body, cursor.Target);
        Assert.Equal("variables.after", cursor.BodyPath);
        Assert.Equal(7, cursor.MaxPages);
    }
}
