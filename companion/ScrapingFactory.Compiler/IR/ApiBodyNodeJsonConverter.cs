using System.Text.Json;
using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// Same abstract-base problem as ContainerNodeJsonConverter/ApiNodeJsonConverter,
// one level further: System.Text.Json can neither instantiate the abstract
// ApiBodyNode during deserialization nor serialize it (as e.g.
// ApiBodyObject.Properties: Dictionary<string, ApiBodyNode>) without silently
// dropping derived-only properties.
//
// The outer 4-way split (Object/Array/Variable/Literal) is discriminated
// structurally, exactly like ApiNode: "properties" means ApiBodyObject,
// "items" means ApiBodyArray, "parameterName" means ApiBodyVariable, and
// anything else is treated as ApiBodyLiteral — none of the four collide on
// property names. ApiBodyLiteral itself keeps its own explicit "kind" tag
// (see its doc comment) rather than being sniffed further: structural
// sniffing can't safely tell "no value set" apart from a literal null, or
// reliably tell a JSON number apart from a numeric-looking JSON string,
// the same reason ApiParameterSource needed an explicit tag in the first
// place instead of the structural approach ContainerNode/ApiNode use.
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
                throw new NotSupportedException($"Unbekannter ApiBodyNode-Typ: {value.GetType()}");
        }
    }
}
