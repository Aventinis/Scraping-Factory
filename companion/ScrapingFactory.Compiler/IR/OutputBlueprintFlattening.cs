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
public static class OutputBlueprintFlattening
{
    public sealed class Result
    {
        // Name of the single repeating GroupNode every mapped field's own
        // deepest repeating ancestor chain agrees on — null when no mapped
        // field has ANY repeating ancestor at all, meaning the whole
        // mapping resolves to exactly one row (nothing repeats).
        public string? RowGroupName { get; init; }

        // Non-null when the mapped fields don't all sit on one single
        // root-to-row ancestor chain (e.g. two unrelated/sibling repeating
        // groups both referenced by the same mapping) — there is no single
        // row layout that includes every mapped field without either a
        // cross-product or dropping data, so this is surfaced as a hard
        // error rather than guessed at.
        public string? Error { get; init; }
    }

    public static Result ResolveContainerRowScope(IReadOnlyList<ContainerNode> roots, IReadOnlyCollection<string> mappedSourceFields)
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
        return ResolveChain(chains);
    }

    // Shared by ResolveContainerRowScope above and, structurally mirrored
    // (not shared code — different language), scraper_api_grouped.py.j2's
    // own runtime version for API mode's tree shape.
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
                            "duplicating rows or dropping data. Map fields from only one repeating branch " +
                            "(see https://github.com/Aventinis/Scraping-Factory/issues/244 for a future nested " +
                            "target schema).",
                };
            }
        }

        return new Result { RowGroupName = winner[^1] };
    }
}
