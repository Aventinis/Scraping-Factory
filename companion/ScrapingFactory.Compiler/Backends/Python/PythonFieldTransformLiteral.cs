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
//
// Issue #205: ToIntegerTransform/ToBooleanTransform/ToDateTransform's
// "onError" is rendered via TransformErrorMode.ToString() ("KeepOriginal"/
// "UseDefault") the exact same way HardeningCheck.Severity.ToString()
// already becomes "Warning"/"Error" in PythonHardeningLiteral — both sides
// (this literal and every template's runtime string comparison) share one
// PascalCase vocabulary instead of a separate camelCase wire convention.
// ToDateTransform.SourceFormat is resolved through RangeFormat.Resolve so
// "unset" always renders as the same explicit default
// (RangeFormat.DefaultDateFormat) the runtime helper would otherwise have
// to reimplement its own fallback for.
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
        ToIntegerTransform toInteger =>
            $$"""{"kind": "toInteger", "onError": {{PythonLiteral.Str(toInteger.OnError.ToString())}}, "defaultValue": {{PythonLiteral.Str(toInteger.DefaultValue ?? "")}}}""",
        ToBooleanTransform toBoolean =>
            $$"""{"kind": "toBoolean", "onError": {{PythonLiteral.Str(toBoolean.OnError.ToString())}}, "defaultValue": {{PythonLiteral.Str(toBoolean.DefaultValue ?? "")}}}""",
        ToDateTransform toDate =>
            $$"""{"kind": "toDate", "sourceFormat": {{PythonLiteral.Str(RangeFormat.Resolve(RangeType.Date, toDate.SourceFormat))}}, "onError": {{PythonLiteral.Str(toDate.OnError.ToString())}}, "defaultValue": {{PythonLiteral.Str(toDate.DefaultValue ?? "")}}}""",
        _ => throw new InvalidOperationException($"Unknown FieldTransform type: {transform.GetType()}"),
    };
}
