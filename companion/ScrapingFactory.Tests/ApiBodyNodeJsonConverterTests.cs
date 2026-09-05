using System.Text.Json;
using System.Text.Json.Serialization;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Exercises ApiBodyNodeJsonConverter directly: without it, System.Text.Json
// can neither deserialize into the abstract ApiBodyNode (e.g.
// ApiBodyObject.Properties) nor serialize a Dictionary/List of ApiBodyNode
// without silently dropping derived-only properties. Same pattern as
// ContainerNodeJsonConverterTests/ApiNodeJsonConverterTests, one level
// further down the tree (write side instead of read side).
public class ApiBodyNodeJsonConverterTests
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(), new ApiNodeJsonConverter(), new ApiBodyNodeJsonConverter() },
    };

    [Fact]
    public void Deserialize_GraphQlShapedBody_ProducesExpectedTree()
    {
        const string json = """
            {
              "url": "https://example.com",
              "api": {
                "method": "POST",
                "urlTemplate": "https://example.com/graphql",
                "parameters": [],
                "itemsPath": "data.categoryProducts.items",
                "fields": [{ "name": "Titel", "path": "title" }],
                "body": {
                  "properties": {
                    "query": { "kind": "String", "stringValue": "query($category: String) { categoryProducts(category: $category) { items { title } } }" },
                    "variables": {
                      "properties": {
                        "category": { "parameterName": "category" }
                      }
                    }
                  }
                }
              }
            }
            """;

        var config = JsonSerializer.Deserialize<ScrapingConfig>(json, Options);

        var body = Assert.IsType<ApiBodyObject>(config!.Api!.Body);
        var query = Assert.IsType<ApiBodyLiteral>(body.Properties["query"]);
        Assert.Equal(ApiBodyLiteralKind.String, query.Kind);
        Assert.Contains("categoryProducts", query.StringValue);

        var variables = Assert.IsType<ApiBodyObject>(body.Properties["variables"]);
        var category = Assert.IsType<ApiBodyVariable>(variables.Properties["category"]);
        Assert.Equal("category", category.ParameterName);
    }

    [Fact]
    public void SerializeThenDeserialize_RoundTripsNestedObjectArrayAndVariable()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Api = new ApiConfig
            {
                Method = "POST",
                UrlTemplate = "https://example.com/api/search",
                ItemsPath = "data.items",
                Fields = [new ApiField { Name = "Titel", Path = "title" }],
                Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
                Body = new ApiBodyObject
                {
                    Properties = new Dictionary<string, ApiBodyNode>
                    {
                        ["category"] = new ApiBodyVariable { ParameterName = "category", CoerceTo = ApiBodyLiteralKind.String },
                        ["tags"] = new ApiBodyArray
                        {
                            Items =
                            [
                                new ApiBodyLiteral { Kind = ApiBodyLiteralKind.String, StringValue = "sale" },
                                new ApiBodyLiteral { Kind = ApiBodyLiteralKind.Number, NumberValue = 42 },
                            ],
                        },
                    },
                },
            },
        };

        var json = JsonSerializer.Serialize(config, Options);
        var roundTripped = JsonSerializer.Deserialize<ScrapingConfig>(json, Options);

        var body = Assert.IsType<ApiBodyObject>(roundTripped!.Api!.Body);
        var category = Assert.IsType<ApiBodyVariable>(body.Properties["category"]);
        Assert.Equal("category", category.ParameterName);
        Assert.Equal(ApiBodyLiteralKind.String, category.CoerceTo);

        var tags = Assert.IsType<ApiBodyArray>(body.Properties["tags"]);
        Assert.Equal(2, tags.Items.Count);
        var firstTag = Assert.IsType<ApiBodyLiteral>(tags.Items[0]);
        Assert.Equal("sale", firstTag.StringValue);
        var secondTag = Assert.IsType<ApiBodyLiteral>(tags.Items[1]);
        Assert.Equal(42, secondTag.NumberValue);
    }

    // A literal null must round-trip as Kind == Null with no value field set
    // — not be confused with "no value present at all" (there is no such
    // state for ApiBodyLiteral; Kind is always present) and not accidentally
    // collapse into one of the other three variants during the structural
    // sniff (a bare "{}"-shaped object with none of properties/items/
    // parameterName present falls through to ApiBodyLiteral, see the
    // converter).
    [Fact]
    public void SerializeThenDeserialize_RoundTripsNullLiteral()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Api = new ApiConfig
            {
                Method = "POST",
                UrlTemplate = "https://example.com/api/search",
                ItemsPath = "data.items",
                Fields = [new ApiField { Name = "Titel", Path = "title" }],
                Parameters = [],
                Body = new ApiBodyObject
                {
                    Properties = new Dictionary<string, ApiBodyNode> { ["optionalFilter"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.Null } },
                },
            },
        };

        var json = JsonSerializer.Serialize(config, Options);
        var roundTripped = JsonSerializer.Deserialize<ScrapingConfig>(json, Options);

        var body = Assert.IsType<ApiBodyObject>(roundTripped!.Api!.Body);
        var literal = Assert.IsType<ApiBodyLiteral>(body.Properties["optionalFilter"]);
        Assert.Equal(ApiBodyLiteralKind.Null, literal.Kind);
        Assert.Null(literal.StringValue);
        Assert.Null(literal.NumberValue);
        Assert.Null(literal.BoolValue);
    }

    [Fact]
    public void SerializeThenDeserialize_RoundTripsBooleanLiteral()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Api = new ApiConfig
            {
                Method = "POST",
                UrlTemplate = "https://example.com/api/search",
                ItemsPath = "data.items",
                Fields = [new ApiField { Name = "Titel", Path = "title" }],
                Parameters = [],
                Body = new ApiBodyObject
                {
                    Properties = new Dictionary<string, ApiBodyNode> { ["includeArchived"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.Boolean, BoolValue = true } },
                },
            },
        };

        var json = JsonSerializer.Serialize(config, Options);
        var roundTripped = JsonSerializer.Deserialize<ScrapingConfig>(json, Options);

        var body = Assert.IsType<ApiBodyObject>(roundTripped!.Api!.Body);
        var literal = Assert.IsType<ApiBodyLiteral>(body.Properties["includeArchived"]);
        Assert.True(literal.BoolValue);
    }
}
