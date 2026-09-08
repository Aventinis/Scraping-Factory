using System.Text.Json;
using System.Text.Json.Serialization;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Exercises FieldTransform's polymorphic (de)serialization (Issue #84) —
// same "no natural structural tell apart" reasoning as ApiParameterSource
// (see ApiParameterSourceJsonTests), so it relies on the same
// [JsonPolymorphic]/[JsonDerivedType] "kind" discriminator instead of a
// hand-written converter like ContainerNodeJsonConverter.
public class FieldTransformJsonTests
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        // ContainerNode/ApiNode need their own hand-written converters
        // (structural discriminator, unlike FieldTransform's own built-in
        // [JsonPolymorphic] support) — same set Program.cs registers for the
        // real /generate endpoint, needed here since some tests below nest a
        // field's Transforms inside a full ScrapingConfig, which can carry
        // either shape.
        Converters = { new JsonStringEnumConverter(), new ContainerNodeJsonConverter(), new ApiNodeJsonConverter() },
    };

    [Fact]
    public void Deserialize_TrimByKind_ProducesTrimTransform()
    {
        const string json = """{ "kind": "trim" }""";

        var transform = JsonSerializer.Deserialize<FieldTransform>(json, Options);

        Assert.IsType<TrimTransform>(transform);
    }

    [Fact]
    public void Deserialize_RegexExtractByKind_ProducesRegexExtractTransform()
    {
        const string json = """{ "kind": "regexExtract", "pattern": "[\\d,]+", "group": 0 }""";

        var transform = JsonSerializer.Deserialize<FieldTransform>(json, Options);

        var regexExtract = Assert.IsType<RegexExtractTransform>(transform);
        Assert.Equal(@"[\d,]+", regexExtract.Pattern);
        Assert.Equal(0, regexExtract.Group);
    }

    [Fact]
    public void Deserialize_RegexExtractWithoutGroup_DefaultsToZero()
    {
        const string json = """{ "kind": "regexExtract", "pattern": "\\d+" }""";

        var transform = JsonSerializer.Deserialize<FieldTransform>(json, Options);

        var regexExtract = Assert.IsType<RegexExtractTransform>(transform);
        Assert.Equal(0, regexExtract.Group);
    }

    [Fact]
    public void Deserialize_ReplaceByKind_ProducesReplaceTransform()
    {
        const string json = """{ "kind": "replace", "find": "-", "replacement": " " }""";

        var transform = JsonSerializer.Deserialize<FieldTransform>(json, Options);

        var replace = Assert.IsType<ReplaceTransform>(transform);
        Assert.Equal("-", replace.Find);
        Assert.Equal(" ", replace.Replacement);
    }

    [Fact]
    public void Deserialize_ToNumberByKind_ProducesToNumberTransform()
    {
        const string json = """{ "kind": "toNumber" }""";

        var transform = JsonSerializer.Deserialize<FieldTransform>(json, Options);

        Assert.IsType<ToNumberTransform>(transform);
    }

    [Fact]
    public void SerializeThenDeserialize_RoundTripsAllFourVariants()
    {
        FieldTransform[] transforms =
        [
            new TrimTransform(),
            new RegexExtractTransform { Pattern = @"\d+", Group = 1 },
            new ReplaceTransform { Find = "€", Replacement = "" },
            new ToNumberTransform(),
        ];

        foreach (var transform in transforms)
        {
            var json = JsonSerializer.Serialize(transform, Options);
            var roundTripped = JsonSerializer.Deserialize<FieldTransform>(json, Options);

            Assert.Equal(transform.GetType(), roundTripped!.GetType());
        }
    }

    // Proves the discriminator survives being nested inside a full
    // ScrapingConfig field, the way the extension would actually send it —
    // one check per field shape (flat/container/API), mirroring
    // ApiParameterSourceJsonTests's own "nested inside ScrapingConfig" check.
    [Fact]
    public void Deserialize_ScrapingConfigWithFlatFieldTransforms_ResolvesChain()
    {
        const string json = """
            {
              "url": "https://example.com",
              "fields": [
                {
                  "name": "Preis",
                  "selector": ".price",
                  "transforms": [
                    { "kind": "trim" },
                    { "kind": "toNumber" }
                  ]
                }
              ]
            }
            """;

        var config = JsonSerializer.Deserialize<ScrapingConfig>(json, Options);

        var field = Assert.Single(config!.Fields);
        Assert.NotNull(field.Transforms);
        Assert.Equal(2, field.Transforms!.Count);
        Assert.IsType<TrimTransform>(field.Transforms[0]);
        Assert.IsType<ToNumberTransform>(field.Transforms[1]);
    }

    [Fact]
    public void Deserialize_ScrapingConfigWithContainerFieldTransforms_ResolvesChain()
    {
        const string json = """
            {
              "url": "https://example.com",
              "groups": [
                {
                  "name": "Angebot",
                  "selector": ".offer",
                  "repeating": true,
                  "children": [
                    {
                      "name": "Preis",
                      "selector": ".price",
                      "mode": "Text",
                      "transforms": [ { "kind": "regexExtract", "pattern": "\\d+" } ]
                    }
                  ]
                }
              ]
            }
            """;

        var config = JsonSerializer.Deserialize<ScrapingConfig>(json, Options);

        var field = Assert.IsType<DataFieldNode>(Assert.Single(config!.Groups![0].Children));
        Assert.NotNull(field.Transforms);
        Assert.IsType<RegexExtractTransform>(Assert.Single(field.Transforms!));
    }

    [Fact]
    public void Deserialize_ScrapingConfigWithApiFieldTransforms_ResolvesChain()
    {
        const string json = """
            {
              "url": "https://example.com",
              "api": {
                "urlTemplate": "https://example.com/api/items",
                "itemsPath": "data.items",
                "fields": [
                  {
                    "name": "Preis",
                    "path": "price",
                    "transforms": [ { "kind": "toNumber" } ]
                  }
                ]
              }
            }
            """;

        var config = JsonSerializer.Deserialize<ScrapingConfig>(json, Options);

        var field = Assert.Single(config!.Api!.Fields!);
        Assert.IsType<ToNumberTransform>(Assert.Single(field.Transforms!));
    }
}
