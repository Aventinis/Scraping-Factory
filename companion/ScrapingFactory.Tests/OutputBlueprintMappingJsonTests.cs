using System.Text.Json;
using System.Text.Json.Serialization;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #191: OutputBlueprintMapping isn't polymorphic (unlike FieldTransform/
// ApiParameterSource) — a plain nested object, so no [JsonPolymorphic]/
// custom converter is needed, just ordinary System.Text.Json (de)serialization.
public class OutputBlueprintMappingJsonTests
{
    private static readonly JsonSerializerOptions Options =
        new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    [Fact]
    public void Deserialize_OutputBlueprintOnScrapingConfig_ResolvesMapping()
    {
        const string json = """
            {
              "url": "https://example.com",
              "fields": [{ "name": "Titel", "selector": "h1" }],
              "outputBlueprint": {
                "blueprintId": 42,
                "fields": [
                  { "targetField": "name", "sourceField": "Titel" }
                ]
              }
            }
            """;

        var config = JsonSerializer.Deserialize<ScrapingConfig>(json, Options);

        Assert.NotNull(config!.OutputBlueprint);
        Assert.Equal(42, config.OutputBlueprint!.BlueprintId);
        var mapping = Assert.Single(config.OutputBlueprint.Fields);
        Assert.Equal("name", mapping.TargetField);
        Assert.Equal("Titel", mapping.SourceField);
    }

    [Fact]
    public void Deserialize_OutputBlueprintWithoutBlueprintId_LeavesItNull()
    {
        const string json = """
            {
              "url": "https://example.com",
              "fields": [{ "name": "Titel", "selector": "h1" }],
              "outputBlueprint": {
                "fields": [{ "targetField": "name", "sourceField": "Titel" }]
              }
            }
            """;

        var config = JsonSerializer.Deserialize<ScrapingConfig>(json, Options);

        Assert.Null(config!.OutputBlueprint!.BlueprintId);
    }

    [Fact]
    public void Deserialize_ScrapingConfigWithoutOutputBlueprint_LeavesItNull()
    {
        const string json = """{ "url": "https://example.com", "fields": [{ "name": "Titel", "selector": "h1" }] }""";

        var config = JsonSerializer.Deserialize<ScrapingConfig>(json, Options);

        Assert.Null(config!.OutputBlueprint);
    }

    [Fact]
    public void SerializeThenDeserialize_RoundTrips()
    {
        var original = new OutputBlueprintMapping
        {
            BlueprintId = 7,
            Fields =
            [
                new OutputBlueprintFieldMapping { TargetField = "name", SourceField = "Titel" },
                new OutputBlueprintFieldMapping { TargetField = "cost", SourceField = "Preis" },
            ],
        };

        var json = JsonSerializer.Serialize(original, Options);
        var roundTripped = JsonSerializer.Deserialize<OutputBlueprintMapping>(json, Options);

        Assert.Equal(original.BlueprintId, roundTripped!.BlueprintId);
        Assert.Equal(2, roundTripped.Fields.Count);
        Assert.Equal("name", roundTripped.Fields[0].TargetField);
        Assert.Equal("Preis", roundTripped.Fields[1].SourceField);
    }
}
