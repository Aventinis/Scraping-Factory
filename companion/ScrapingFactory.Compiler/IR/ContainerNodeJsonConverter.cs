using System.Text.Json;
using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// System.Text.Json can't instantiate an abstract type (ContainerNode) during
// deserialization, and by default serializes collection elements using their
// *declared* type — silently dropping GroupNode/DataFieldNode-only
// properties (Selector, Repeating, Children, Mode, Attribute) when writing a
// List<ContainerNode>. This converter handles both directions.
//
// Discriminates the same way the generated Python does at runtime
// ("children" in node — see PythonGroupTreeLiteral and the grouped
// templates): presence of a "children" property means GroupNode, its
// absence means DataFieldNode. Keeps the wire format exactly as documented
// (no extra "kind"/"$type" discriminator field) at the cost of this
// converter having to peek at the raw JSON first.
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
                throw new NotSupportedException($"Unbekannter ContainerNode-Typ: {value.GetType()}");
        }
    }
}
