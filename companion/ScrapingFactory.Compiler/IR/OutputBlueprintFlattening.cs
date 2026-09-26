namespace ScrapingFactory.Compiler.IR;

// Issue #192: extends #191's flat Output Blueprint mapping to container
// mode by *flattening* the source tree into denormalized rows instead of
// renaming tags in place — one row per instance of the single repeating
// group every mapped field's own ancestor chain shares, with any
// higher-level mapped field (outside that repeating group, e.g. a category
// name sitting next to a repeating list of items) copied into every row
// generated beneath it, so no value is ever silently lost the way writing
// it only once would. See CLAUDE.md's Output Blueprints section for the
// full worked example this resolves (the "Speise-Art" case).
//
// Deliberately container-mode only: this walk relies on GroupNode.Repeating
// being an explicit, config-time-known flag. API mode's own tree shape
// (ApiGroup) has no such flag at all — whether a node is repeating is only
// ever known once the real JSON response is resolved at script run time
// (Architecture Decision #6) — so the equivalent ambiguity check for that
// shape has no static, generate-time counterpart; it happens in the
// generated Python script itself instead (see scraper_api_grouped.py.j2's
// own runtime mirror of ResolveChain below), surfacing as a normal 422
// trial-run verification failure rather than a 400 here.
//
// Issue #244: ResolveContainerTreeRowScopes below extends this same
// mechanism to a tree-shaped Output Blueprint target schema — instead of
// resolving ONE row scope for the whole (flat) mapping, it resolves one row
// scope PER TARGET GROUP NODE, recursively, each still via ResolveChain
// (unchanged) but scoped to only the leaf fields mapped directly beneath
// that target group (not any of its own nested target groups, which get
// their own independent resolution). This is what actually lets two
// independent/sibling source repeating groups — the exact case the flat
// mapping above refuses — coexist in one mapping, as long as the target
// schema places them under two different target group branches: the tree's
// own nesting is the disambiguation, per Issue #244's own resolution of that
// open question.
public static class OutputBlueprintFlattening
{
    public sealed class Result
    {
        // Name of the single repeating GroupNode every mapped field's own
        // deepest repeating ancestor chain agrees on — null when no mapped
        // field has ANY repeating ancestor at all, meaning the whole
        // mapping resolves to exactly one row (nothing repeats).
        public string? RowGroupName { get; init; }

        // Full root-to-row chain of repeating GroupNode names RowGroupName
        // is the last entry of — [] when RowGroupName is null. Exposed (in
        // addition to RowGroupName) so ResolveContainerTreeRowScopes can
        // both validate a nested target group's own chain extends its
        // parent's, and pass the resolved chain down as that parent's own
        // ancestor context for further recursion.
        public List<string> RowGroupChain { get; init; } = [];

        // Non-null when the mapped fields don't all sit on one single
        // root-to-row ancestor chain (e.g. two unrelated/sibling repeating
        // groups both referenced by the same mapping) — there is no single
        // row layout that would include every mapped field without either a
        // cross-product or dropping data, so this is surfaced as a hard
        // error rather than guessed at.
        public string? Error { get; init; }
    }

    public static Result ResolveContainerRowScope(IReadOnlyList<ContainerNode> roots, IReadOnlyCollection<string> mappedSourceFields) =>
        ResolveChain(CollectSourceFieldChains(roots, mappedSourceFields));

    // Issue #244: resolves a row scope per target GROUP node of a tree-
    // shaped mapping, recursively — success/failure only (no per-group
    // result is needed by any caller; the actual nested-output construction
    // happens at runtime in the generated Python script, exactly like the
    // flat case's own ResolveContainerRowScope is a validation-only,
    // generate-time pre-check of what _flatten_group_tree_for_blueprint
    // already computes independently at runtime).
    public static Result ResolveContainerTreeRowScopes(IReadOnlyList<ContainerNode> sourceRoots, IReadOnlyList<OutputBlueprintTreeMappingNode> targetNodes) =>
        ResolveTargetGroupScope(sourceRoots, targetNodes, ancestorContext: []);

    private static Result ResolveTargetGroupScope(
        IReadOnlyList<ContainerNode> sourceRoots, IReadOnlyList<OutputBlueprintTreeMappingNode> targetChildren, List<string> ancestorContext)
    {
        var directSourceFields = CollectDirectTargetSourceFields(targetChildren);
        var chains = CollectSourceFieldChains(sourceRoots, directSourceFields);

        // Every chain must either broadcast (empty — a page-level field with
        // no repeating ancestor at all) or actually be reachable from
        // wherever the enclosing target group already scoped things to —
        // i.e. have ancestorContext as a literal prefix. A field whose own
        // chain diverges from ancestorContext before reaching its depth (or
        // never reaches it at all) is nested in the wrong place in the
        // target tree relative to what it actually resolves to in the
        // source tree.
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

        // This target group's own resolved chain (falls back to the
        // ancestor context unchanged when none of its direct fields add any
        // further nesting — e.g. a target group holding only nested target
        // groups of its own) becomes the ancestor context every nested
        // target group child is resolved against in turn.
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

    // Leaf SourceFields mapped directly under this level of the target
    // tree — deliberately NOT descending into a nested
    // OutputBlueprintTreeMappingGroup's own children, which get their own,
    // independent row-scope resolution one level down.
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

    // Shared by ResolveContainerRowScope/ResolveContainerTreeRowScopes above
    // and, structurally mirrored (not shared code — different language),
    // scraper_api_grouped.py.j2's own runtime version for API mode's tree
    // shape.
    private static Result ResolveChain(List<List<string>> chains)
    {
        // A field with no repeating ancestor at all contributes an empty
        // chain — it simply broadcasts into whatever the row scope ends up
        // being (or the whole mapping is one single row, if every field's
        // chain is empty).
        var nonEmpty = chains.Where(chain => chain.Count > 0).ToList();
        if (nonEmpty.Count == 0)
            return new Result { RowGroupName = null };

        // The winning row-scope chain is whichever reaches deepest; every
        // other mapped field's own chain must be an exact prefix of it —
        // i.e. sit on the very same root-to-row path — for the mapping to
        // have one unambiguous row granularity.
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
