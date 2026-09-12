using System.Text.Json;
using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// Same problem/shape as ContainerNodeJsonConverter, one level down: System.Text.Json
// can't instantiate the abstract ApiNode during deserialization, and would silently
// drop ApiGroup-only properties (Path, Children) when writing a List<ApiNode>. Only
// needed for ApiGroup.Children: List<ApiNode> — ApiConfig.Groups: List<ApiGroup> is
// non-polymorphic and needs no converter, exactly mirroring how ScrapingConfig.Groups:
// List<GroupNode> needs none but GroupNode.Children: List<ContainerNode> does.
//
// Discriminated structurally, not via an explicit "kind" tag like
// ApiParameterSource: ApiGroup vs. ApiField has the same "branch has Children, leaf
// doesn't" asymmetry as GroupNode vs. DataFieldNode, which is exactly what let
// ContainerNodeJsonConverter avoid a tag in the first place — presence of a
// "children" property means ApiGroup, its absence means ApiField.
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
