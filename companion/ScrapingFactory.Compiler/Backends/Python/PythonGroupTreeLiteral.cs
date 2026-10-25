using System.Linq;
using System.Text;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Serializes the container tree into Python source: a nested list-of-dicts literal embedded as GROUPS by both
// grouped templates. Scriban cannot recurse across templates, so the structure is built here; only the DOM-access
// calls in extract_group() differ per engine.
internal static class PythonGroupTreeLiteral
{
    // True iff some field has Download enabled (the script then needs the download helper and its imports).
    public static bool AnyDownloadEnabled(IReadOnlyList<ContainerNode> nodes) => nodes.Any(node => node switch
    {
        DataFieldNode field => field.Download,
        GroupNode group => AnyDownloadEnabled(group.Children),
        _ => false,
    });

    // Every hidden field name in the tree, matched globally by name at write time (like NullRateCheck); feeds the
    // templates' HIDDEN_FIELD_NAMES.
    public static IReadOnlyList<string> CollectHiddenFieldNames(IReadOnlyList<ContainerNode> nodes) => nodes.SelectMany(node => node switch
    {
        DataFieldNode { HiddenFromOutput: true } field => new[] { field.Name },
        DataFieldNode => Array.Empty<string>(),
        GroupNode group => CollectHiddenFieldNames(group.Children),
        _ => Array.Empty<string>(),
    }).ToList();

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

    // The "children" key (even if empty) tells extract_group() a group from a leaf. "frame_path" is omitted when null.
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
        // transform, download, maxDownloadSizeBytes, allowedContentTypes and hiddenFromOutput are always present, so
        // extract_group() reads them with a plain node.get(...).
        var transformPart = $$""", "transform": {{PythonFieldTransformLiteral.Render(field.Transforms)}}""";
        var downloadPart = $$""", "download": {{(field.Download ? "True" : "False")}}""";
        var maxSizePart = $$""", "maxDownloadSizeBytes": {{field.MaxDownloadSizeBytes?.ToString() ?? "None"}}""";
        var allowedTypesPart = $$""", "allowedContentTypes": {{(field.AllowedContentTypes is { Count: > 0 } ? PythonLiteral.StrList(field.AllowedContentTypes) : "[]")}}""";
        var hiddenPart = $$""", "hiddenFromOutput": {{(field.HiddenFromOutput ? "True" : "False")}}""";
        // Selector is "" (never None) when blank; a derived field's selector is never read.
        return $$"""{"name": {{PythonLiteral.Str(field.Name)}}, "selector": {{PythonLiteral.Str(field.Selector ?? "")}}, "mode": {{PythonLiteral.Str(mode)}}{{attributePart}}{{framePathPart}}{{transformPart}}{{downloadPart}}{{maxSizePart}}{{allowedTypesPart}}{{hiddenPart}}}""";
    }

    private static string FramePathPart(List<string>? framePath) =>
        framePath is { Count: > 0 } ? $""", "frame_path": {PythonLiteral.StrList(framePath)}""" : "";
}
