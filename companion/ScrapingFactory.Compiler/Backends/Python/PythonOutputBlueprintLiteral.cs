using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Issue #191: serializes OutputBlueprintMapping.Fields into a Python
// list-of-dicts literal — the runtime counterpart the three flat-shape
// templates' write-time remap reads (see scraper.py.j2/
// playwright_scraper.py.j2/scraper_api.py.j2's own BLUEPRINT_MAPPING
// constant). Mirrors PythonFieldTransformLiteral's Render(...) exactly:
// one canonical serialization, "[]" for null/empty (= today's behavior,
// output keyed/ordered by the source fields' own names).
internal static class PythonOutputBlueprintLiteral
{
    public static string Render(OutputBlueprintMapping? mapping)
    {
        if (mapping is null || mapping.Fields.Count == 0)
            return "[]";

        return "[" + string.Join(", ", mapping.Fields.Select(field =>
            $$"""{"target": {{PythonLiteral.Str(field.TargetField)}}, "source": {{PythonLiteral.Str(field.SourceField)}}}""")) + "]";
    }
}
