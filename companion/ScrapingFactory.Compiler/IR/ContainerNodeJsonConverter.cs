using System.Text.Json;
using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// System.Text.Json cannot instantiate the abstract ContainerNode and would serialize list elements by their
// declared type, dropping GroupNode/DataFieldNode-only properties. Discriminated structurally, like the generated
// Python does: a "children" property means GroupNode, otherwise DataFieldNode (no extra "kind" field).
public sealed class ContainerNodeJsonConverter : JsonConverter<ContainerNode>
{
    public override ContainerNode? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        using var document = JsonDocument.ParseValue(ref reader);
        var isGroup = document.RootElement.EnumerateObject()
            .Any(property => string.Equals(property.Name, "children", StringComparison.OrdinalIgnoreCase));

        var rawText = document.RootElement.GetRawText();
        return isGroup
            ? JsonSerializer.Deserialize<GroupNode>(rawText, options)
            : JsonSerializer.Deserialize<DataFieldNode>(rawText, options);
    }

    public override void Write(Utf8JsonWriter writer, ContainerNode value, JsonSerializerOptions options)
    {
        switch (value)
        {
            case GroupNode group:
                JsonSerializer.Serialize(writer, group, options);
                break;
            case DataFieldNode field:
                JsonSerializer.Serialize(writer, field, options);
                break;
            default:
                throw new NotSupportedException($"Unknown ContainerNode type: {value.GetType()}");
        }
    }
}
