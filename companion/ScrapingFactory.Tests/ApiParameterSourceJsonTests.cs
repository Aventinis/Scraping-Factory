using System.Text.Json;
using System.Text.Json.Serialization;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Exercises ApiParameterSource's polymorphic (de)serialization: unlike
// ContainerNode (discriminated structurally by ContainerNodeJsonConverter,
// see ContainerNodeJsonConverterTests), StaticListSource/DiscoverySource/
// RangeSource have no natural structural tell, so they rely on
// System.Text.Json's built-in [JsonPolymorphic]/[JsonDerivedType] support
// with an explicit "kind" discriminator instead of a hand-written converter.
public class ApiParameterSourceJsonTests
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    [Fact]
    public void Deserialize_StaticListSourceByKind_ProducesStaticListSource()
    {
        const string json = """{ "kind": "staticList", "values": ["a", "b"] }""";

        var source = JsonSerializer.Deserialize<ApiParameterSource>(json, Options);

        var staticList = Assert.IsType<StaticListSource>(source);
        Assert.Equal(["a", "b"], staticList.Values);
    }

    [Fact]
    public void Deserialize_DiscoverySourceByKind_ProducesDiscoverySource()
    {
        const string json = """
            {
              "kind": "discovery",
              "urlTemplate": "https://example.com/api/categories",
              "itemsPath": "data",
              "valuePath": "id"
            }
            """;

        var source = JsonSerializer.Deserialize<ApiParameterSource>(json, Options);

        var discovery = Assert.IsType<DiscoverySource>(source);
        Assert.Equal("GET", discovery.Method);
        Assert.Equal("https://example.com/api/categories", discovery.UrlTemplate);
        Assert.Equal("data", discovery.ItemsPath);
        Assert.Equal("id", discovery.ValuePath);
    }

    [Fact]
    public void Deserialize_RangeSourceByKind_ProducesRangeSource()
    {
        const string json = """{ "kind": "range", "type": "IsoWeek", "from": "2026-W01", "to": "today" }""";

        var source = JsonSerializer.Deserialize<ApiParameterSource>(json, Options);

        var range = Assert.IsType<RangeSource>(source);
        Assert.Equal(RangeType.IsoWeek, range.Type);
        Assert.Equal("2026-W01", range.From);
        Assert.Equal("today", range.To);
    }

    [Fact]
    public void SerializeThenDeserialize_RoundTripsAllThreeVariants()
    {
        ApiParameterSource[] sources =
        [
            new StaticListSource { Values = ["Elektronik", "Bücher"] },
            new DiscoverySource { UrlTemplate = "https://example.com/api/categories", ItemsPath = "data", ValuePath = "slug" },
            new RangeSource { Type = RangeType.Number, From = "1", To = "10" },
        ];

        foreach (var source in sources)
        {
            var json = JsonSerializer.Serialize(source, Options);
            var roundTripped = JsonSerializer.Deserialize<ApiParameterSource>(json, Options);

            Assert.Equal(source.GetType(), roundTripped!.GetType());
        }
    }

    // Proves the discriminator survives being nested inside a full
    // ScrapingConfig, the way the extension would actually send it.
    [Fact]
    public void Deserialize_ScrapingConfigWithApiParameters_ResolvesEachSourceKind()
    {
        const string json = """
            {
              "url": "https://example.com",
              "api": {
                "urlTemplate": "https://example.com/api/items?category={category}&week={week}",
                "itemsPath": "data.items",
                "fields": [ { "name": "Titel", "path": "title" } ],
                "parameters": [
                  { "name": "category", "source": { "kind": "staticList", "values": ["a", "b"] } },
                  {
                    "name": "week",
                    "source": {
                      "kind": "range",
                      "type": "IsoWeek",
                      "from": "2026-W01",
                      "to": "today"
                    }
                  }
                ]
              }
            }
            """;

        var config = JsonSerializer.Deserialize<ScrapingConfig>(json, Options);

        Assert.NotNull(config!.Api);
        Assert.Equal(2, config.Api.Parameters.Count);
        Assert.IsType<StaticListSource>(config.Api.Parameters[0].Source);
        Assert.IsType<RangeSource>(config.Api.Parameters[1].Source);
    }
}
