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
        _ => throw new InvalidOperationException($"Unbekannter Container-Knoten-Typ: {node.GetType()}"),
    };

    // Presence of the "children" key (even if empty) is what extract_group()
    // uses at runtime to tell a group from a leaf field — see the grouped
    // templates.
    private static string RenderGroup(GroupNode group, int indent)
    {
        var children = Render(group.Children, indent);
        return $$"""{"name": {{PyStr(group.Name)}}, "selector": {{PyStr(group.Selector)}}, "repeating": {{(group.Repeating ? "True" : "False")}}, "children": {{children}}}""";
    }

    private static string RenderField(DataFieldNode field)
    {
        var mode = field.Mode switch
        {
            ExtractMode.Text => "text",
            ExtractMode.Attribute => "attribute",
            ExtractMode.Exists => "exists",
            _ => throw new InvalidOperationException($"Unbekannter ExtractMode: {field.Mode}"),
        };
        var attributePart = field.Mode == ExtractMode.Attribute ? $""", "attribute": {PyStr(field.Attribute!)}""" : "";
        return $$"""{"name": {{PyStr(field.Name)}}, "selector": {{PyStr(field.Selector)}}, "mode": {{PyStr(mode)}}{{attributePart}}}""";
    }

    // Python single-quoted string literal, escaped for the characters a
    // user-entered name/selector/attribute could plausibly contain
    // (backslash, single quote, newline/CR/tab) so a value can't break out
    // of the literal or corrupt the generated script.
    private static string PyStr(string value)
    {
        var escaped = value
            .Replace("\\", "\\\\")
            .Replace("'", "\\'")
            .Replace("\n", "\\n")
            .Replace("\r", "\\r")
            .Replace("\t", "\\t");
        return $"'{escaped}'";
    }
}
