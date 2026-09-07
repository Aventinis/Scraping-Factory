using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Serializes Issue #84's FieldTransform chain into a Python list-of-dicts
// literal — the runtime counterpart every generated template's
// _apply_transforms(value, transforms) helper walks. One canonical
// serialization used everywhere a field can carry Transforms (flat mode's
// TRANSFORMS dict in PythonCodeGenerator/PythonPlaywrightCodeGenerator,
// container mode's PythonGroupTreeLiteral.RenderField, API mode's
// PythonApiConfigLiteral), same rationale as PythonGroupTreeLiteral/
// PythonApiConfigLiteral: the shape is built once here in C# rather than
// re-derived per template.
internal static class PythonFieldTransformLiteral
{
    public static string Render(IReadOnlyList<FieldTransform>? transforms)
    {
        if (transforms is null || transforms.Count == 0)
            return "[]";

        return "[" + string.Join(", ", transforms.Select(RenderTransform)) + "]";
    }

    private static string RenderTransform(FieldTransform transform) => transform switch
    {
        TrimTransform => """{"kind": "trim"}""",
        RegexExtractTransform regexExtract =>
            $$"""{"kind": "regexExtract", "pattern": {{PythonLiteral.Str(regexExtract.Pattern)}}, "group": {{regexExtract.Group}}}""",
        ReplaceTransform replace =>
            $$"""{"kind": "replace", "find": {{PythonLiteral.Str(replace.Find)}}, "replacement": {{PythonLiteral.Str(replace.Replacement)}}}""",
        ToNumberTransform => """{"kind": "toNumber"}""",
        _ => throw new InvalidOperationException($"Unbekannter FieldTransform-Typ: {transform.GetType()}"),
    };
}
