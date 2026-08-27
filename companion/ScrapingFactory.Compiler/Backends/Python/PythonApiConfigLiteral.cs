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
        RangeSource r => $$"""{"kind": "range", "type": {{PythonLiteral.Str(r.Type.ToString())}}, "from": {{PythonLiteral.Str(r.From)}}, "to": {{PythonLiteral.Str(r.To)}}}""",
        _ => throw new InvalidOperationException($"Unbekannter ApiParameterSource-Typ: {source.GetType()}"),
    };

    private static string RenderList<T>(List<T> items, Func<T, string> renderItem) =>
        "[" + string.Join(", ", items.Select(renderItem)) + "]";
}
