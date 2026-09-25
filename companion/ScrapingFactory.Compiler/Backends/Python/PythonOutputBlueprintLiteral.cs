using System.Text;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Issue #191: serializes OutputBlueprintMapping.Fields into a Python
// list-of-dicts literal — the runtime counterpart the three flat-shape
// templates' write-time remap reads (see scraper.py.j2/
// playwright_scraper.py.j2/scraper_api.py.j2's own BLUEPRINT_MAPPING
// constant). Mirrors PythonFieldTransformLiteral's Render(...) exactly:
// one canonical serialization, "[]" for null/empty (= today's behavior,
// output keyed/ordered by the source fields' own names).
//
// Issue #244: RenderTree below is the tree-shaped counterpart, used by the
// three tree-shape templates (scraper_grouped.py.j2/
// playwright_scraper_grouped.py.j2/scraper_api_grouped.py.j2) alongside
// Render — a single ScrapingPlan.OutputBlueprint is only ever one
// SchemaKind at a time, so exactly one of the two ever renders non-"[]" for
// a given plan, but both constants are always emitted so the template's own
// Scriban conditionals stay simple (branch on which list is non-empty,
// never on SchemaKind directly).
internal static class PythonOutputBlueprintLiteral
{
    public static string Render(OutputBlueprintMapping? mapping)
    {
        if (mapping is not { SchemaKind: OutputBlueprintSchemaKind.Flat, Fields.Count: > 0 })
            return "[]";

        return "[" + string.Join(", ", mapping.Fields!.Select(field =>
            $$"""{"target": {{PythonLiteral.Str(field.TargetField)}}, "source": {{PythonLiteral.Str(field.SourceField)}}}""")) + "]";
    }

    // Mirrors PythonGroupTreeLiteral.Render's own nested list-of-dicts
    // layout exactly — a group node is {"name", "children"}, a leaf is
    // {"name", "source"} (the leaf's own bound source field, the tree-
    // mapping analog of OutputBlueprintFieldMapping.SourceField above).
    public static string RenderTree(OutputBlueprintMapping? mapping, int indent = 0)
    {
        if (mapping is not { SchemaKind: OutputBlueprintSchemaKind.Tree, Tree.Count: > 0 })
            return "[]";

        return RenderNodes(mapping.Tree!, indent);
    }

    private static string RenderNodes(IReadOnlyList<OutputBlueprintTreeMappingNode> nodes, int indent)
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

    private static string RenderNode(OutputBlueprintTreeMappingNode node, int indent) => node switch
    {
        OutputBlueprintTreeMappingGroup group =>
            $$"""{"name": {{PythonLiteral.Str(group.Name)}}, "children": {{RenderNodes(group.Children, indent)}}}""",
        OutputBlueprintTreeMappingField field =>
            $$"""{"name": {{PythonLiteral.Str(field.Name)}}, "source": {{PythonLiteral.Str(field.SourceField)}}}""",
        _ => throw new InvalidOperationException($"Unknown OutputBlueprintTreeMappingNode type: {node.GetType()}"),
    };
}
