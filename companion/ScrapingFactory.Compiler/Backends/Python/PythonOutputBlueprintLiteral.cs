using System.Text;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Serializes the flat mapping into a Python list-of-dicts literal for the flat-shape templates' write-time remap
// ("[]" = no mapping). RenderTree is the tree counterpart for the tree-shape templates; a plan has only one schema
// kind, so exactly one renders non-empty, but both constants are always emitted to keep the templates simple.
internal static class PythonOutputBlueprintLiteral
{
    public static string Render(OutputBlueprintMapping? mapping)
    {
        if (mapping is not { SchemaKind: OutputBlueprintSchemaKind.Flat, Fields.Count: > 0 })
            return "[]";

        return "[" + string.Join(", ", mapping.Fields!.Select(field =>
            $$"""{"target": {{PythonLiteral.Str(field.TargetField)}}, "source": {{PythonLiteral.Str(field.SourceField)}}}""")) + "]";
    }

    // Same nested layout as PythonGroupTreeLiteral: a group is {"name", "children"}, a leaf {"name", "source"}.
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
