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
public sealed class OutputBlueprintMapping
{
    // Which persisted Output Blueprint (see OutputBlueprintStore) this
    // mapping was built against — carried through purely for the
    // extension's own round-tripping (Issue #141's "Load" for a saved
    // configuration that used a blueprint, and a later cross-configuration
    // hardening-comparison feature scoped by blueprint) and never read
    // during generation itself.
    public long? BlueprintId { get; init; }

    // Ordered target-field -> source-field pairs; this order is also the
    // generated output's own column order, overriding whatever order Fields
    // (or Api.Fields) were declared in. Strictly 1:1 per the issue's own
    // scope — validated in ScrapingPlanValidator that no SourceField and no
    // TargetField repeats, and that every SourceField actually names a
    // field the rest of the config extracts. A source field with no entry
    // here at all is simply omitted from the output, never written under
    // its own original name.
    public required List<OutputBlueprintFieldMapping> Fields { get; init; }
}

public sealed class OutputBlueprintFieldMapping
{
    public required string TargetField { get; init; }
    public required string SourceField { get; init; }
}
