using System.Text.Json;
using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// Same as ContainerNodeJsonConverter: a "children" property means OutputBlueprintTreeMappingGroup, otherwise ...Field.
public sealed class OutputBlueprintTreeMappingNodeJsonConverter : JsonConverter<OutputBlueprintTreeMappingNode>
{
    public override OutputBlueprintTreeMappingNode? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        using var document = JsonDocument.ParseValue(ref reader);
        var isGroup = document.RootElement.EnumerateObject()
            .Any(property => string.Equals(property.Name, "children", StringComparison.OrdinalIgnoreCase));

        var rawText = document.RootElement.GetRawText();
        return isGroup
            ? JsonSerializer.Deserialize<OutputBlueprintTreeMappingGroup>(rawText, options)
            : JsonSerializer.Deserialize<OutputBlueprintTreeMappingField>(rawText, options);
    }

    public override void Write(Utf8JsonWriter writer, OutputBlueprintTreeMappingNode value, JsonSerializerOptions options)
    {
        switch (value)
        {
            case OutputBlueprintTreeMappingGroup group:
                JsonSerializer.Serialize(writer, group, options);
                break;
            case OutputBlueprintTreeMappingField field:
                JsonSerializer.Serialize(writer, field, options);
                break;
            default:
                throw new NotSupportedException($"Unknown OutputBlueprintTreeMappingNode type: {value.GetType()}");
        }
    }
}
