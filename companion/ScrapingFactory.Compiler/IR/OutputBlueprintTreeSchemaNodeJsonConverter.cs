using System.Text.Json;
using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// Issue #244: same reason/shape as ContainerNodeJsonConverter — System.Text.
// Json can't deserialize into OutputBlueprintTreeSchemaNode's abstract base
// type, and would silently drop OutputBlueprintTreeSchemaGroup-only
// properties (Children) when serializing a
// List<OutputBlueprintTreeSchemaNode> through its declared type. Discriminates
// structurally (presence of a "children" property), exactly like
// ContainerNodeJsonConverter/ApiNodeJsonConverter — no natural need for an
// explicit "kind" tag here either.
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
