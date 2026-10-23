using System.Text.Json;
using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// Same as ContainerNodeJsonConverter: a "children" property means OutputBlueprintTreeSchemaGroup, otherwise ...Field.
public sealed class OutputBlueprintTreeSchemaNodeJsonConverter : JsonConverter<OutputBlueprintTreeSchemaNode>
{
    public override OutputBlueprintTreeSchemaNode? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        using var document = JsonDocument.ParseValue(ref reader);
        var isGroup = document.RootElement.EnumerateObject()
            .Any(property => string.Equals(property.Name, "children", StringComparison.OrdinalIgnoreCase));

        var rawText = document.RootElement.GetRawText();
        return isGroup
            ? JsonSerializer.Deserialize<OutputBlueprintTreeSchemaGroup>(rawText, options)
            : JsonSerializer.Deserialize<OutputBlueprintTreeSchemaField>(rawText, options);
    }

    public override void Write(Utf8JsonWriter writer, OutputBlueprintTreeSchemaNode value, JsonSerializerOptions options)
    {
        switch (value)
        {
            case OutputBlueprintTreeSchemaGroup group:
                JsonSerializer.Serialize(writer, group, options);
                break;
            case OutputBlueprintTreeSchemaField field:
                JsonSerializer.Serialize(writer, field, options);
                break;
            default:
                throw new NotSupportedException($"Unknown OutputBlueprintTreeSchemaNode type: {value.GetType()}");
        }
    }
}
