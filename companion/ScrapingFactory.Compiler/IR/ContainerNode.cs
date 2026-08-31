namespace ScrapingFactory.Compiler.IR;

// Container-Mode's tree shape, parallel to the flat ScrapingField: a
// GroupNode scopes its children to matches of its own selector (either
// exactly one, or N repeated instances), DataFieldNode is the leaf that
// actually extracts a value from within that scope. See ExtractGroupStep.
public abstract class ContainerNode
{
    public required string Name { get; init; }
}

public sealed class GroupNode : ContainerNode
{
    // Relative to the parent scope (document for a root node, the matched
    // element for a nested one) — same relative-selector convention the
    // codegen's extract_group() walks at runtime.
    public required string Selector { get; init; }

    // false = exactly one match expected ("Einzelnes Element"), true = the
    // selector may match N times, one <Name> element per match
    // ("Wiederholend"). Chosen explicitly by the user, never inferred from
    // match count.
    public required bool Repeating { get; init; }

    public required List<ContainerNode> Children { get; init; }

    // Browser-engine only (Issue #42, Phase 3): see ExtractStep.FramePath —
    // same meaning, resolved as an *absolute* path from the top document
    // regardless of this node's own nesting depth in the tree, independent
    // of any ancestor's FramePath (there's no path composition/inheritance
    // — every node's FramePath, when set, is a complete top-to-target
    // chain). null (the default) means Selector is evaluated against the
    // inherited scope exactly as before this field existed.
    public List<string>? FramePath { get; init; }
}

public sealed class DataFieldNode : ContainerNode
{
    public required string Selector { get; init; }
    public ExtractMode Mode { get; init; } = ExtractMode.Text;

    // Only meaningful (and required) when Mode == Attribute.
    public string? Attribute { get; init; }

    // See GroupNode.FramePath — same meaning and same "absolute, not
    // inherited" semantics.
    public List<string>? FramePath { get; init; }
}

public enum ExtractMode { Text, Attribute, Exists }
