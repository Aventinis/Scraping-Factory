using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Serializes a FieldTransform chain into a Python list-of-dicts literal, the one serialization every field shape uses
// (flat TRANSFORMS, the group tree, API fields); the runtime's _apply_transforms walks it. "onError" renders as the
// PascalCase enum name (the same vocabulary as hardening severity); an unset ToDate SourceFormat renders as the
// explicit ISO default (RangeFormat.Resolve).
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
        ToCurrencyTransform toCurrency =>
            $$"""{"kind": "toCurrency", "format": {{PythonLiteral.Str(toCurrency.Format)}}, "onError": {{PythonLiteral.Str(toCurrency.OnError.ToString())}}, "defaultValue": {{PythonLiteral.Str(toCurrency.DefaultValue ?? "")}}}""",
        CombineFieldsTransform combine =>
            $$"""{"kind": "combineFields", "sourceFieldNames": {{PythonLiteral.StrList(combine.SourceFieldNames)}}, "separator": {{PythonLiteral.Str(combine.Separator)}}}""",
        SplitFieldTransform split =>
            $$"""{"kind": "splitField", "sourceFieldName": {{PythonLiteral.Str(split.SourceFieldName)}}, "separator": {{PythonLiteral.Str(split.Separator)}}, "index": {{split.Index}}}""",
        _ => throw new InvalidOperationException($"Unknown FieldTransform type: {transform.GetType()}"),
    };
}
