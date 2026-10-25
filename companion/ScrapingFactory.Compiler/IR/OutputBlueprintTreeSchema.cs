namespace ScrapingFactory.Compiler.IR;

// The persisted, site-independent target shape of a tree-shaped Output Blueprint: names and nesting only.
// Deliberately not ContainerNode/ApiNode (no selector, path or mode), and no Repeating flag: whether a target
// group yields one or many instances is derived from its mapped fields (OutputBlueprintFlattening).
public abstract class OutputBlueprintTreeSchemaNode
{
    public required string Name { get; init; }
}

public sealed class OutputBlueprintTreeSchemaGroup : OutputBlueprintTreeSchemaNode
{
    public required List<OutputBlueprintTreeSchemaNode> Children { get; init; }
}

public sealed class OutputBlueprintTreeSchemaField : OutputBlueprintTreeSchemaNode
{
}

public static class OutputBlueprintTreeSchemaValidator
{
    // Structural only (non-blank names, recursion): there is no source tree to check names against yet.
    public static string? Validate(IReadOnlyList<OutputBlueprintTreeSchemaNode> nodes)
    {
        if (nodes.Count == 0)
            return "Output Blueprint tree schema needs at least one node.";

        foreach (var node in nodes)
        {
            if (string.IsNullOrWhiteSpace(node.Name))
                return "Output Blueprint tree schema: node name must not be empty.";

            if (node is OutputBlueprintTreeSchemaGroup group)
            {
                var childError = Validate(group.Children);
                if (childError is not null)
                    return childError;
            }
        }

        return null;
    }
}
