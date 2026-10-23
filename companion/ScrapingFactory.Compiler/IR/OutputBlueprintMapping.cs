namespace ScrapingFactory.Compiler.IR;

// Remaps a scrape's fields onto a fixed target shape (names and order) so differently configured scrapers produce
// the same output for one downstream consumer. The extension sends the blueprint's fields verbatim; the companion
// never re-reads the persisted blueprint during generation.
public sealed class OutputBlueprintMapping
{
    // Which persisted blueprint this was built from; round-tripping only, never read during generation.
    public long? BlueprintId { get; init; }

    // Picks which of Fields / Tree is populated; Flat is the default for older requests.
    public OutputBlueprintSchemaKind SchemaKind { get; init; } = OutputBlueprintSchemaKind.Flat;

    // Flat: ordered target-to-source pairs, strictly 1:1; the order is the output's column order. A source field
    // without an entry is left out of the output.
    public List<OutputBlueprintFieldMapping>? Fields { get; init; }

    // Tree: mirrors the persisted target tree node for node; each leaf names its SourceField. Which source group a
    // target group draws from is inferred from its mapped leaves (OutputBlueprintFlattening).
    public List<OutputBlueprintTreeMappingNode>? Tree { get; init; }
}

public sealed class OutputBlueprintFieldMapping
{
    public required string TargetField { get; init; }
    public required string SourceField { get; init; }
}

public enum OutputBlueprintSchemaKind { Flat, Tree }

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
