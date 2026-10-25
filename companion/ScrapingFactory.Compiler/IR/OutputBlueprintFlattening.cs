namespace ScrapingFactory.Compiler.IR;

// A blueprint mapping on a container tree flattens it into denormalized rows: one row per instance of the single
// repeating group all mapped fields share, a higher-level mapped field (a category name above a repeating list)
// is copied into every row beneath it. Worked example: docs/design-notes/compiler.md (Output Blueprints).
//
// Container mode only: it needs GroupNode.Repeating to be known at configuration time. For API trees
// repeating-ness exists only at run time, so scraper_api_grouped.py.j2 mirrors ResolveChain there and a conflict
// surfaces as a 422 trial-run failure instead of a 400.
//
// ResolveContainerTreeRowScopes does the same per target group of a tree-shaped blueprint, which is what allows
// two independent repeating source groups when the target puts them under different branches.
public static class OutputBlueprintFlattening
{
    public sealed class Result
    {
        // The repeating group all mapped fields agree on; null = nothing repeats, one row.
        public string? RowGroupName { get; init; }

        // Root-to-row chain of repeating group names ending in RowGroupName ([] when null); lets a nested target
        // group be checked against its parent's chain.
        public List<string> RowGroupChain { get; init; } = [];

        // Set when the mapped fields do not sit on one ancestor chain (two sibling repeating groups): no single
        // row layout fits without a cross product or dropped data.
        public string? Error { get; init; }
    }

    public static Result ResolveContainerRowScope(IReadOnlyList<ContainerNode> roots, IReadOnlyCollection<string> mappedSourceFields) =>
        ResolveChain(CollectSourceFieldChains(roots, mappedSourceFields));

    // A row scope per target group, recursively. Validation only: the nested output is built at run time.
    public static Result ResolveContainerTreeRowScopes(IReadOnlyList<ContainerNode> sourceRoots, IReadOnlyList<OutputBlueprintTreeMappingNode> targetNodes) =>
        ResolveTargetGroupScope(sourceRoots, targetNodes, ancestorContext: []);

    private static Result ResolveTargetGroupScope(
        IReadOnlyList<ContainerNode> sourceRoots, IReadOnlyList<OutputBlueprintTreeMappingNode> targetChildren, List<string> ancestorContext)
    {
        var directSourceFields = CollectDirectTargetSourceFields(targetChildren);
        var chains = CollectSourceFieldChains(sourceRoots, directSourceFields);

        // A chain must be empty (a page-level field that broadcasts) or start with the enclosing group's chain;
        // anything else is nested in the wrong place of the target tree.
        foreach (var chain in chains)
        {
            if (chain.Count == 0) continue;
            var reachable = chain.Count >= ancestorContext.Count && chain.Take(ancestorContext.Count).SequenceEqual(ancestorContext);
            if (!reachable)
            {
                return new Result
                {
                    Error = "Output Blueprint: source field(s) mapped under a target group don't sit within " +
                            $"that group's own resolved source scope ('{string.Join(" > ", ancestorContext)}') — " +
                            $"'{chain[^1]}' is not nested there. Move the field to the target group matching its " +
                            "actual position in the source tree.",
                };
            }
        }

        var ownScope = ResolveChain(chains);
        if (ownScope.Error is not null)
            return ownScope;

        // Becomes the context for nested target groups (unchanged if this group's fields add no nesting).
        var ownChain = ownScope.RowGroupChain.Count > 0 ? ownScope.RowGroupChain : ancestorContext;

        foreach (var child in targetChildren)
        {
            if (child is not OutputBlueprintTreeMappingGroup childGroup) continue;
            var childResult = ResolveTargetGroupScope(sourceRoots, childGroup.Children, ownChain);
            if (childResult.Error is not null)
                return childResult;
        }

        return ownScope;
    }

    // Leaves directly under this level only; nested target groups are resolved on their own.
    private static List<string> CollectDirectTargetSourceFields(IReadOnlyList<OutputBlueprintTreeMappingNode> nodes) =>
        nodes.OfType<OutputBlueprintTreeMappingField>().Select(field => field.SourceField).ToList();

    private static List<List<string>> CollectSourceFieldChains(IReadOnlyList<ContainerNode> roots, IReadOnlyCollection<string> mappedSourceFields)
    {
        var chains = new List<List<string>>();

        void Walk(IEnumerable<ContainerNode> nodes, List<string> repeatingAncestors)
        {
            foreach (var node in nodes)
            {
                switch (node)
                {
                    case GroupNode group:
                        var nextAncestors = group.Repeating
                            ? [.. repeatingAncestors, group.Name]
                            : repeatingAncestors;
                        Walk(group.Children, nextAncestors);
                        break;
                    case DataFieldNode field when mappedSourceFields.Contains(field.Name):
                        chains.Add(repeatingAncestors);
                        break;
                }
            }
        }

        Walk(roots, []);
        return chains;
    }

    private static Result ResolveChain(List<List<string>> chains)
    {
        // An empty chain broadcasts into whatever the row scope is.
        var nonEmpty = chains.Where(chain => chain.Count > 0).ToList();
        if (nonEmpty.Count == 0)
            return new Result { RowGroupName = null };

        // The deepest chain wins; every other chain must be a prefix of it.
        var winner = nonEmpty.OrderByDescending(chain => chain.Count).First();
        foreach (var chain in nonEmpty)
        {
            var isPrefixOfWinner = chain.Count <= winner.Count && winner.Take(chain.Count).SequenceEqual(chain);
            if (!isPrefixOfWinner)
            {
                return new Result
                {
                    Error = "Output Blueprint: the mapped fields span more than one independent repeating group " +
                            $"(e.g. '{chain[^1]}' and '{winner[^1]}' are not on the same nesting path) — there is " +
                            "no single row layout that would include every mapped field without either " +
                            "duplicating rows or dropping data. Map fields from only one repeating branch, or use " +
                            "a tree-shaped Output Blueprint target schema instead (Issue #244), which lets " +
                            "independent repeating branches map into separate parts of one nested target shape.",
                };
            }
        }

        return new Result { RowGroupName = winner[^1], RowGroupChain = winner };
    }
}
