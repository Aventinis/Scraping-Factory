using System.Text.Json;
using System.Text.Json.Serialization;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Exercises ApiNodeJsonConverter directly: without it, System.Text.Json can
// neither deserialize into the abstract ApiNode (ApiGroup.Children) nor
// serialize a List<ApiNode> without silently dropping derived-only
// properties (Path, Children). Same pattern as ContainerNodeJsonConverterTests,
// one level down — see ApiNodeJsonConverterTests.
public class ApiNodeJsonConverterTests
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(), new ApiNodeJsonConverter() },
    };

    [Fact]
    public void Deserialize_ThreeLevelNestedGroups_ProducesExpectedTree()
    {
        const string json = """
            {
              "url": "https://example.com",
              "api": {
                "urlTemplate": "https://example.com/api/catalog",
                "parameters": [],
                "groups": [
                  {
                    "name": "Kategorie",
                    "path": "categories",
                    "children": [
                      { "name": "KategorieName", "path": "name" },
                      {
                        "name": "Unterkategorie",
                        "path": "subcategories",
                        "children": [
                          {
                            "name": "Produkt",
                            "path": "products",
                            "children": [
                              { "name": "Titel", "path": "title" },
                              { "name": "Preis", "path": "price" }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            }
            """;

        var config = JsonSerializer.Deserialize<ScrapingConfig>(json, Options);

        var root = Assert.Single(config!.Api!.Groups!);
        Assert.Equal("Kategorie", root.Name);
        Assert.Equal("categories", root.Path);
        Assert.Equal(2, root.Children.Count);

        var kategorieName = Assert.IsType<ApiField>(root.Children[0]);
        Assert.Equal("name", kategorieName.Path);

        var unterkategorie = Assert.IsType<ApiGroup>(root.Children[1]);
        Assert.Equal("subcategories", unterkategorie.Path);

        var produkt = Assert.IsType<ApiGroup>(Assert.Single(unterkategorie.Children));
        Assert.Equal("products", produkt.Path);
        Assert.Equal(2, produkt.Children.Count);

        var titel = Assert.IsType<ApiField>(produkt.Children[0]);
        Assert.Equal("title", titel.Path);
        var preis = Assert.IsType<ApiField>(produkt.Children[1]);
        Assert.Equal("price", preis.Path);
    }

    [Fact]
    public void SerializeThenDeserialize_RoundTripsGroupAndFieldProperties()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Api = new ApiConfig
            {
                UrlTemplate = "https://example.com/api/catalog",
                Groups =
                [
                    new ApiGroup
                    {
                        Name = "Kategorie",
                        Path = "categories",
                        Children =
                        [
                            new ApiField { Name = "Titel", Path = "name" },
                            new ApiGroup
                            {
                                Name = "Produkt",
                                Path = "products",
                                Children = [new ApiField { Name = "Preis", Path = "price" }],
                            },
                        ],
                    },
                ],
            },
        };

        var json = JsonSerializer.Serialize(config, Options);
        var roundTripped = JsonSerializer.Deserialize<ScrapingConfig>(json, Options);

        var root = Assert.Single(roundTripped!.Api!.Groups!);
        Assert.Equal("categories", root.Path);
        Assert.Equal(2, root.Children.Count);
        var produkt = Assert.IsType<ApiGroup>(root.Children[1]);
        Assert.Equal("products", produkt.Path);
        var preis = Assert.IsType<ApiField>(Assert.Single(produkt.Children));
        Assert.Equal("price", preis.Path);
    }

    // A root ApiGroup.Path of "" (array-of-arrays: no object key between two
    // directly-nested repeating levels) must survive the round trip as an
    // empty string, not be conflated with "unset"/null.
    [Fact]
    public void SerializeThenDeserialize_RoundTripsEmptyGroupPath()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Api = new ApiConfig
            {
                UrlTemplate = "https://example.com/api/matrix",
                Groups = [new ApiGroup { Name = "Zeile", Path = "", Children = [new ApiField { Name = "Wert", Path = "" }] }],
            },
        };

        var json = JsonSerializer.Serialize(config, Options);
        var roundTripped = JsonSerializer.Deserialize<ScrapingConfig>(json, Options);

        var root = Assert.Single(roundTripped!.Api!.Groups!);
        Assert.Equal("", root.Path);
    }

    // ApiField (the flat shape's own type, Issue #53) must keep working
    // completely unchanged now that it's also a leaf variant of ApiNode —
    // List<ApiField> was never polymorphic and never went through this
    // converter in the first place, but this proves that becoming an ApiNode
    // subtype didn't change its own (de)serialization.
    [Fact]
    public void SerializeThenDeserialize_FlatApiFieldListRoundTripsUnchanged()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Api = new ApiConfig
            {
                UrlTemplate = "https://example.com/api/items",
                ItemsPath = "data.items",
                Fields = [new ApiField { Name = "Titel", Path = "title" }],
                Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
            },
        };

        var json = JsonSerializer.Serialize(config, Options);
        var roundTripped = JsonSerializer.Deserialize<ScrapingConfig>(json, Options);

        Assert.Equal("data.items", roundTripped!.Api!.ItemsPath);
        var field = Assert.Single(roundTripped.Api.Fields!);
        Assert.Equal("Titel", field.Name);
        Assert.Equal("title", field.Path);
    }
}
