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
        Assert.Equal(OutputBlueprintSchemaKind.Flat, config.OutputBlueprint.SchemaKind);
        var mapping = Assert.Single(config.OutputBlueprint.Fields!);
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
        Assert.Equal(2, roundTripped.Fields!.Count);
        Assert.Equal("name", roundTripped.Fields[0].TargetField);
        Assert.Equal("Preis", roundTripped.Fields[1].SourceField);
    }

    // Issue #244: the tree-shaped mapping payload round-trips through the
    // same plain (non-polymorphic at this outer level) OutputBlueprintMapping
    // wrapper — only Tree's own elements need the structural
    // OutputBlueprintTreeMappingNodeJsonConverter (registered explicitly
    // here, mirroring how Program.cs registers it for the real HTTP pipeline).
    private static readonly JsonSerializerOptions TreeOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(), new OutputBlueprintTreeMappingNodeJsonConverter() },
    };

    [Fact]
    public void Deserialize_TreeSchemaKind_ResolvesNestedMappingTree()
    {
        const string json = """
            {
              "schemaKind": "Tree",
              "tree": [
                {
                  "name": "Kategorien",
                  "children": [
                    { "name": "Name", "sourceField": "KategorieName" },
                    { "name": "Gerichte", "children": [{ "name": "Preis", "sourceField": "Preis" }] }
                  ]
                }
              ]
            }
            """;

        var mapping = JsonSerializer.Deserialize<OutputBlueprintMapping>(json, TreeOptions);

        Assert.Equal(OutputBlueprintSchemaKind.Tree, mapping!.SchemaKind);
        Assert.Null(mapping.Fields);
        var root = Assert.IsType<OutputBlueprintTreeMappingGroup>(Assert.Single(mapping.Tree!));
        Assert.Equal("Kategorien", root.Name);
        var nameLeaf = Assert.IsType<OutputBlueprintTreeMappingField>(root.Children[0]);
        Assert.Equal("KategorieName", nameLeaf.SourceField);
        var nestedGroup = Assert.IsType<OutputBlueprintTreeMappingGroup>(root.Children[1]);
        Assert.Equal("Gerichte", nestedGroup.Name);
    }

    [Fact]
    public void SerializeThenDeserialize_TreeSchemaKind_RoundTrips()
    {
        var original = new OutputBlueprintMapping
        {
            SchemaKind = OutputBlueprintSchemaKind.Tree,
            Tree =
            [
                new OutputBlueprintTreeMappingGroup
                {
                    Name = "Kategorien",
                    Children = [new OutputBlueprintTreeMappingField { Name = "Name", SourceField = "KategorieName" }],
                },
            ],
        };

        var json = JsonSerializer.Serialize(original, TreeOptions);
        var roundTripped = JsonSerializer.Deserialize<OutputBlueprintMapping>(json, TreeOptions);

        Assert.Equal(OutputBlueprintSchemaKind.Tree, roundTripped!.SchemaKind);
        var root = Assert.IsType<OutputBlueprintTreeMappingGroup>(Assert.Single(roundTripped.Tree!));
        Assert.Equal("Kategorien", root.Name);
        Assert.Equal("KategorieName", Assert.IsType<OutputBlueprintTreeMappingField>(root.Children[0]).SourceField);
    }
}
