using System.Text;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Serializes a Container-Mode tree into Python source: a nested list-of-dicts
// literal that both grouped templates (scraper_grouped.py.j2 /
// playwright_scraper_grouped.py.j2) embed verbatim as the GROUPS constant.
// Scriban can't recurse across templates, so the tree *structure* is built
// here in C# rather than in Scriban — only the two DOM-access calls inside
// each template's extract_group() differ per engine, the tree-of-dicts shape
// consumed at runtime is identical either way.
internal static class PythonGroupTreeLiteral
{
    public static string Render(IReadOnlyList<ContainerNode> nodes, int indent = 0)
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

    private static string RenderNode(ContainerNode node, int indent) => node switch
    {
        GroupNode group => RenderGroup(group, indent),
        DataFieldNode field => RenderField(field),
        _ => throw new InvalidOperationException($"Unknown container node type: {node.GetType()}"),
    };

    // Presence of the "children" key (even if empty) is what extract_group()
    // uses at runtime to tell a group from a leaf field — see the grouped
    // templates. "frame_path" (Issue #42, Phase 3) is omitted entirely when
    // null, same "absent key = no FramePath" convention as "attribute"
    // below — extract_group() reads it via node.get("frame_path").
    private static string RenderGroup(GroupNode group, int indent)
    {
        var children = Render(group.Children, indent);
        var framePathPart = FramePathPart(group.FramePath);
        return $$"""{"name": {{PythonLiteral.Str(group.Name)}}, "selector": {{PythonLiteral.Str(group.Selector)}}, "repeating": {{(group.Repeating ? "True" : "False")}}{{framePathPart}}, "children": {{children}}}""";
    }

    private static string RenderField(DataFieldNode field)
    {
        var mode = field.Mode switch
        {
            ExtractMode.Text => "text",
            ExtractMode.Attribute => "attribute",
            ExtractMode.Exists => "exists",
            ExtractMode.OwnText => "ownText",
            _ => throw new InvalidOperationException($"Unknown ExtractMode: {field.Mode}"),
        };
        var attributePart = field.Mode == ExtractMode.Attribute ? $""", "attribute": {PythonLiteral.Str(field.Attribute!)}""" : "";
        var framePathPart = FramePathPart(field.FramePath);
        // Always present (never omitted like attribute/frame_path above) —
        // Issue #84's transform chain isn't tied to a specific Mode branch,
        // so extract_group() can just do node.get("transform", []) uniformly.
        var transformPart = $$""", "transform": {{PythonFieldTransformLiteral.Render(field.Transforms)}}""";
        return $$"""{"name": {{PythonLiteral.Str(field.Name)}}, "selector": {{PythonLiteral.Str(field.Selector)}}, "mode": {{PythonLiteral.Str(mode)}}{{attributePart}}{{framePathPart}}{{transformPart}}}""";
    }

    private static string FramePathPart(List<string>? framePath) =>
        framePath is { Count: > 0 } ? $""", "frame_path": {PythonLiteral.StrList(framePath)}""" : "";
}
