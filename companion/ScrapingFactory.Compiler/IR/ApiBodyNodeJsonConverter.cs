using System.Text.Json;
using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// Same abstract-base problem as ContainerNodeJsonConverter. Discriminated structurally: "properties" = object,
// "items" = array, "parameterName" = variable, anything else = literal. ApiBodyLiteral keeps its own explicit
// "kind" because structure cannot tell "no value" from a literal null or a number from a numeric string.
public sealed class ApiBodyNodeJsonConverter : JsonConverter<ApiBodyNode>
{
    public override ApiBodyNode? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        using var document = JsonDocument.ParseValue(ref reader);
        var properties = document.RootElement.EnumerateObject().Select(property => property.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var rawText = document.RootElement.GetRawText();

        if (properties.Contains("properties"))
            return JsonSerializer.Deserialize<ApiBodyObject>(rawText, options);
        if (properties.Contains("items"))
            return JsonSerializer.Deserialize<ApiBodyArray>(rawText, options);
        if (properties.Contains("parameterName"))
            return JsonSerializer.Deserialize<ApiBodyVariable>(rawText, options);
        return JsonSerializer.Deserialize<ApiBodyLiteral>(rawText, options);
    }

    public override void Write(Utf8JsonWriter writer, ApiBodyNode value, JsonSerializerOptions options)
    {
        switch (value)
        {
            case ApiBodyObject obj:
                JsonSerializer.Serialize(writer, obj, options);
                break;
            case ApiBodyArray array:
                JsonSerializer.Serialize(writer, array, options);
                break;
            case ApiBodyVariable variable:
                JsonSerializer.Serialize(writer, variable, options);
                break;
            case ApiBodyLiteral literal:
                JsonSerializer.Serialize(writer, literal, options);
                break;
            default:
                throw new NotSupportedException($"Unknown ApiBodyNode type: {value.GetType()}");
        }
    }
}
