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
}

public sealed class DataFieldNode : ContainerNode
{
    public required string Selector { get; init; }
    public ExtractMode Mode { get; init; } = ExtractMode.Text;

    // Only meaningful (and required) when Mode == Attribute.
    public string? Attribute { get; init; }
}

public enum ExtractMode { Text, Attribute, Exists }
