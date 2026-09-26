namespace ScrapingFactory.Compiler.IR;

// Issue #244: a second, tree-shaped Output Blueprint target schema alongside
// #191's flat, ordered field-name list — lets a persisted blueprint describe
// an actual nested/repeating output structure (mirroring the container/API
// tree editors already in the extension) instead of only ever a flat row.
//
// Deliberately its own small node type, not a reuse of ContainerNode/ApiNode:
// a blueprint's target schema is site-independent (no CSS selector/JSON path,
// no engine/mode concept at all) — a group only ever carries a Name and
// Children, a field only a Name. Which SOURCE field/group a given target node
// resolves to at generate time lives on the separate, per-scrape
// OutputBlueprintTreeMappingNode (see OutputBlueprintMapping.cs) instead —
// the persisted schema itself only ever describes the target *shape*.
//
// No explicit "Repeating" flag on a target group, unlike GroupNode — whether
// a given target group ends up producing one or many instances is entirely
// derived at mapping-resolution time from what its mapped fields' common
// source ancestor turns out to be (see OutputBlueprintFlattening.
// ResolveContainerTreeRowScopes), the same "inferred, not chosen" reasoning
// Architecture Decision #6 already established for ApiGroup — a user
// designing a reusable, site-independent target schema has no source tree in
// front of them yet to decide repeating-ness against in the first place.
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

// Same "no natural structural tell would be needed if it weren't for one
// missing property" situation ContainerNodeJsonConverter already handles —
// a group has Children, a field doesn't, so the structural discriminator
// (presence of a "children" key) is reused verbatim rather than adding an
// explicit "kind" tag.
public static class OutputBlueprintTreeSchemaValidator
{
    // Structural-only check (non-blank names, recursion) — mirrors
    // ScrapingPlanValidator's own "laissez-faire" stance on anything that can
    // only ever be judged once real data exists (there is no source tree to
    // check node names against yet; this schema is site-independent).
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
