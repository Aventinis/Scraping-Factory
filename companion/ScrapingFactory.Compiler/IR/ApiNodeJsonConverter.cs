using System.Text.Json;
using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// Same as ContainerNodeJsonConverter, for ApiGroup.Children: List<ApiNode>. Discriminated structurally: a "children"
// property means ApiGroup, otherwise ApiField (unlike ApiParameterSource, which needs a "kind" tag).
public sealed class ApiNodeJsonConverter : JsonConverter<ApiNode>
{
    public override ApiNode? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        using var document = JsonDocument.ParseValue(ref reader);
        var isGroup = document.RootElement.EnumerateObject()
            .Any(property => string.Equals(property.Name, "children", StringComparison.OrdinalIgnoreCase));

        var rawText = document.RootElement.GetRawText();
        return isGroup
            ? JsonSerializer.Deserialize<ApiGroup>(rawText, options)
            : JsonSerializer.Deserialize<ApiField>(rawText, options);
    }

    public override void Write(Utf8JsonWriter writer, ApiNode value, JsonSerializerOptions options)
    {
        switch (value)
        {
            case ApiGroup group:
                JsonSerializer.Serialize(writer, group, options);
                break;
            case ApiField field:
                JsonSerializer.Serialize(writer, field, options);
                break;
            default:
                throw new NotSupportedException($"Unknown ApiNode type: {value.GetType()}");
        }
    }
}
