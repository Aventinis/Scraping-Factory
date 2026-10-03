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
        Assert.Null(range.Format);
    }

    [Fact]
    public void Deserialize_RangeSourceWithFormat_ProducesRangeSourceWithFormat()
    {
        const string json = """{ "kind": "range", "type": "IsoWeek", "from": "2026-35", "to": "2026-50", "format": "{yyyy}-{ww}" }""";

        var source = JsonSerializer.Deserialize<ApiParameterSource>(json, Options);

        var range = Assert.IsType<RangeSource>(source);
        Assert.Equal("{yyyy}-{ww}", range.Format);
    }

    // Issue #216: unlike the other three, BrowserDiscoverySource nests
    // another polymorphic list of its own (Actions: List<BrowserAction>) —
    // proves the outer "kind" discriminator still resolves correctly with a
    // nested one in play, not just a flat object.
    [Fact]
    public void Deserialize_BrowserDiscoverySourceByKind_ProducesBrowserDiscoverySource()
    {
        const string json = """
            {
              "kind": "browserDiscovery",
              "discoveryUrl": "https://example.com/angebote",
              "actions": [
                { "kind": "click", "selector": "#load-more" }
              ]
            }
            """;

        var source = JsonSerializer.Deserialize<ApiParameterSource>(json, Options);

        var browserDiscovery = Assert.IsType<BrowserDiscoverySource>(source);
        Assert.Equal("https://example.com/angebote", browserDiscovery.DiscoveryUrl);
        var action = Assert.Single(browserDiscovery.Actions!);
        Assert.IsType<ClickAction>(action);
        Assert.Equal("#load-more", ((ClickAction)action).Selector);
    }

    [Fact]
    public void Deserialize_BrowserDiscoverySourceWithNoActions_ProducesEmptyActions()
    {
        const string json = """{ "kind": "browserDiscovery", "discoveryUrl": "https://example.com/angebote" }""";

        var source = JsonSerializer.Deserialize<ApiParameterSource>(json, Options);

        var browserDiscovery = Assert.IsType<BrowserDiscoverySource>(source);
        Assert.Null(browserDiscovery.Actions);
    }

    [Fact]
    public void SerializeThenDeserialize_RoundTripsAllFourVariants()
    {
        ApiParameterSource[] sources =
        [
            new StaticListSource { Values = ["Elektronik", "Bücher"] },
            new DiscoverySource { UrlTemplate = "https://example.com/api/categories", ItemsPath = "data", ValuePath = "slug" },
            new RangeSource { Type = RangeType.Number, From = "1", To = "10" },
            new RangeSource { Type = RangeType.IsoWeek, From = "2026-35", To = "2026-50", Format = "{yyyy}-{ww}" },
            new BrowserDiscoverySource { DiscoveryUrl = "https://example.com/angebote" },
            new BrowserDiscoverySource
            {
                DiscoveryUrl = "https://example.com/angebote",
                Actions = [new ScrollAction { MaxIterations = 5 }, new ClickAction { Selector = "#more" }],
            },
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
