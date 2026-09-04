using System.Text;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Serializes an ApiConfig into Python source: a handful of module-level
// constants (FIELDS/PARAMETERS/HEADERS) that scraper_api.py.j2 embeds
// verbatim. Same rationale as PythonGroupTreeLiteral: ApiParameterSource has
// three shapes (StaticListSource/DiscoverySource/RangeSource) with no common
// structure for Scriban to loop over generically, so the dict-of-dicts shape
// is built here in C#, and the template's runtime code only needs to switch
// on a "kind" string identical to the wire format's JSON discriminator (see
// ApiConfig.cs's [JsonPolymorphic] attribute).
internal static class PythonApiConfigLiteral
{
    public static string RenderFields(List<ApiField> fields) =>
        RenderList(fields, field =>
            $$"""{"name": {{PythonLiteral.Str(field.Name)}}, "path": {{PythonLiteral.Str(field.Path)}}}""");

    // Serializes ApiConfig.Groups (Issue #54's tree shape) the same way
    // PythonGroupTreeLiteral serializes Container-Mode's GroupNode tree:
    // a nested list-of-dicts literal that scraper_api_grouped.py.j2's
    // _extract_api_group() walks at runtime, using presence of the
    // "children" key as the group-vs-field discriminator (mirroring
    // ApiNodeJsonConverter's own structural discriminator on the wire).
    public static string RenderGroups(IReadOnlyList<ApiGroup> groups, int indent = 0) =>
        RenderNodes(groups, indent);

    private static string RenderNodes(IReadOnlyList<ApiNode> nodes, int indent)
    {
        if (nodes.Count == 0)
            return "[]";

        var pad = new string(' ', indent);
        var childPad = new string(' ', indent + 4);
        var sb = new StringBuilder();
        sb.Append("[\n");
        foreach (var node in nodes)
            sb.Append(childPad).Append(RenderNode(node, indent + 4)).Append(",\n");
        sb.Append(pad).Append(']');
        return sb.ToString();
    }

    private static string RenderNode(ApiNode node, int indent) => node switch
    {
        ApiGroup group => RenderGroup(group, indent),
        ApiField field => RenderField(field),
        _ => throw new InvalidOperationException($"Unbekannter Api-Knoten-Typ: {node.GetType()}"),
    };

    private static string RenderGroup(ApiGroup group, int indent)
    {
        var children = RenderNodes(group.Children, indent);
        return $$"""{"name": {{PythonLiteral.Str(group.Name)}}, "path": {{PythonLiteral.Str(group.Path)}}, "children": {{children}}}""";
    }

    private static string RenderField(ApiField field) =>
        $$"""{"name": {{PythonLiteral.Str(field.Name)}}, "path": {{PythonLiteral.Str(field.Path)}}}""";

    public static string RenderParameters(List<ApiParameter> parameters) =>
        RenderList(parameters, parameter =>
            $$"""{"name": {{PythonLiteral.Str(parameter.Name)}}, "source": {{RenderSource(parameter.Source)}}}""");

    public static string RenderHeaders(List<ApiHeader>? headers) =>
        headers is null ? "[]" : RenderList(headers, RenderHeader);

    // Mirrors ScrapingPlanValidator.ValidateApiHeaders's "meaningful" check
    // (IsNullOrWhiteSpace, not just != null) — an empty-string
    // EnvironmentVariableName alongside a set Value passes validation as "Value
    // wins" there, so codegen has to agree on which one is actually set.
    private static string RenderHeader(ApiHeader header) => !string.IsNullOrWhiteSpace(header.EnvironmentVariableName)
        ? $$"""{"name": {{PythonLiteral.Str(header.Name)}}, "envVar": {{PythonLiteral.Str(header.EnvironmentVariableName)}}}"""
        : $$"""{"name": {{PythonLiteral.Str(header.Name)}}, "value": {{PythonLiteral.Str(header.Value!)}}}""";

    private static string RenderSource(ApiParameterSource source) => source switch
    {
        StaticListSource s => $$"""{"kind": "staticList", "values": [{{string.Join(", ", s.Values.Select(PythonLiteral.Str))}}]}""",
        DiscoverySource d => $$"""{"kind": "discovery", "urlTemplate": {{PythonLiteral.Str(d.UrlTemplate)}}, "itemsPath": {{PythonLiteral.Str(d.ItemsPath)}}, "valuePath": {{PythonLiteral.Str(d.ValuePath)}}}""",
        // "format" is omitted when unset (rather than sending the resolved
        // default) so the runtime's own RangeFormat.Resolve-equivalent
        // (_resolve_parameter_values's `source.get("format")` fallback in
        // scraper_api.py.j2) stays the single source of truth for defaults.
        RangeSource r => $$"""{"kind": "range", "type": {{PythonLiteral.Str(r.Type.ToString())}}, "from": {{PythonLiteral.Str(r.From)}}, "to": {{PythonLiteral.Str(r.To)}}{{RenderFormatSuffix(r.Format)}}}""",
        _ => throw new InvalidOperationException($"Unbekannter ApiParameterSource-Typ: {source.GetType()}"),
    };

    private static string RenderFormatSuffix(string? format) =>
        format is null ? "" : $$""", "format": {{PythonLiteral.Str(format)}}""";

    private static string RenderList<T>(List<T> items, Func<T, string> renderItem) =>
        "[" + string.Join(", ", items.Select(renderItem)) + "]";
}
