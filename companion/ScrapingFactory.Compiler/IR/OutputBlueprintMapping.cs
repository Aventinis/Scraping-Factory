namespace ScrapingFactory.Compiler.IR;

// Issue #191: opt-in field-name/order remapping applied to a flat-shaped
// output (this config's own Fields, or Api mode's flat ItemsPath/Fields
// shape — see ScrapingConfig.OutputBlueprint) right before it's written,
// so multiple differently-configured scrapers (potentially for entirely
// different sites) can all be made to produce the exact same output shape
// for a shared downstream consumer. Deliberately NOT resolved against the
// persisted OutputBlueprint store at generate time — the extension already
// knows the blueprint's full target-field list/order (it fetched it to
// build this mapping in the first place) and sends it verbatim, the same
// "companion never re-reads a referenced persisted entity" pattern
// CombinedComponentConfig.SavedConfigId already establishes for a saved
// configuration.
//
// Issue #244: SchemaKind picks which of the two mutually exclusive payloads
// below is populated — Flat (Fields, #191/#192's original shape, still the
// default for a mapping with no SchemaKind at all, so an older extension
// build's request stays byte-for-byte valid) or Tree (Tree, the new
// nested/repeating target shape). One entity/wire type carries both rather
// than two distinct mapping types, mirroring how OutputBlueprintStore
// persists both schema kinds in the same table.
public sealed class OutputBlueprintMapping
{
    // Which persisted Output Blueprint (see OutputBlueprintStore) this
    // mapping was built against — carried through purely for the
    // extension's own round-tripping (Issue #141's "Load" for a saved
    // configuration that used a blueprint, and a later cross-configuration
    // hardening-comparison feature scoped by blueprint) and never read
    // during generation itself.
    public long? BlueprintId { get; init; }

    public OutputBlueprintSchemaKind SchemaKind { get; init; } = OutputBlueprintSchemaKind.Flat;

    // Ordered target-field -> source-field pairs; this order is also the
    // generated output's own column order, overriding whatever order Fields
    // (or Api.Fields) were declared in. Strictly 1:1 per the issue's own
    // scope — validated in ScrapingPlanValidator that no SourceField and no
    // TargetField repeats, and that every SourceField actually names a
    // field the rest of the config extracts. A source field with no entry
    // here at all is simply omitted from the output, never written under
    // its own original name. Only meaningful when SchemaKind == Flat — null
    // for a Tree mapping (was `required`; relaxed to nullable for Issue
    // #244 so a Tree-kind payload doesn't need an empty placeholder here).
    public List<OutputBlueprintFieldMapping>? Fields { get; init; }

    // Issue #244: the tree-shaped counterpart to Fields above — only
    // meaningful when SchemaKind == Tree. Mirrors the persisted blueprint's
    // own OutputBlueprintTreeSchemaNode shape node-for-node (same Name per
    // node, same Children nesting for a group) with one addition: each leaf
    // (OutputBlueprintTreeMappingField) carries the SourceField it resolves
    // to for this particular scrape, exactly like OutputBlueprintFieldMapping
    // does for the flat shape. Which SOURCE GROUP a given target group's own
    // instances are drawn from is deliberately not part of this wire shape
    // at all — it's re-derived from the leaf SourceField mappings alone (see
    // OutputBlueprintFlattening.ResolveContainerTreeRowScopes), the same
    // "inferred from the mapped fields, never chosen directly" reasoning the
    // original flat-mode row-scope resolution (Issue #192) already
    // established.
    public List<OutputBlueprintTreeMappingNode>? Tree { get; init; }
}

public sealed class OutputBlueprintFieldMapping
{
    public required string TargetField { get; init; }
    public required string SourceField { get; init; }
}

public enum OutputBlueprintSchemaKind { Flat, Tree }

// See OutputBlueprintMapping.Tree above.
public abstract class OutputBlueprintTreeMappingNode
{
    public required string Name { get; init; }
}

public sealed class OutputBlueprintTreeMappingGroup : OutputBlueprintTreeMappingNode
{
    public required List<OutputBlueprintTreeMappingNode> Children { get; init; }
}

public sealed class OutputBlueprintTreeMappingField : OutputBlueprintTreeMappingNode
{
    public required string SourceField { get; init; }
}
