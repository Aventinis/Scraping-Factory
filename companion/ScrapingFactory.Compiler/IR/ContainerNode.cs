namespace ScrapingFactory.Compiler.IR;

// Container mode's tree: a GroupNode scopes its children to matches of its selector, a DataFieldNode extracts a
// value within that scope. See ExtractGroupStep.
public abstract class ContainerNode
{
    public required string Name { get; init; }
}

public sealed class GroupNode : ContainerNode
{
    // Relative to the parent scope (the document for a root node, the matched element for a nested one).
    public required string Selector { get; init; }

    // false = exactly one match expected, true = N matches, one element per match. Chosen by the user, never
    // inferred from the match count.
    public required bool Repeating { get; init; }

    public required List<ContainerNode> Children { get; init; }

    // Browser engine only. Absolute from the top document, not inherited or composed with an ancestor's FramePath.
    public List<string>? FramePath { get; init; }
}

public sealed class DataFieldNode : ContainerNode
{
    // Blank only for a derived field (see ScrapingField.Selector).
    public string? Selector { get; init; }
    public ExtractMode Mode { get; init; } = ExtractMode.Text;

    // Required when Mode == Attribute.
    public string? Attribute { get; init; }

    public List<string>? FramePath { get; init; }

    // Not applied for Mode == Exists.
    public List<FieldTransform>? Transforms { get; init; }

    // Mode == Attribute only: the value is a URL; the script downloads it and writes the local file path instead.
    public bool Download { get; init; }

    // Download safety net: a response over the size or outside the allowed content types counts as a failed
    // download (a warning and an empty field), never a hard failure.
    public int? MaxDownloadSizeBytes { get; init; }
    public List<string>? AllowedContentTypes { get; init; }

    public bool HiddenFromOutput { get; init; }
}

// OwnText takes only the element's direct text nodes: <h3>Burrata<span>vegan</span></h3> gives "Burrata", where
// Text would give both.
public enum ExtractMode { Text, Attribute, Exists, OwnText }
