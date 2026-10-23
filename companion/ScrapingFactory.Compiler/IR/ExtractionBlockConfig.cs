namespace ScrapingFactory.Compiler.IR;

// One entry of ScrapingConfig.Blocks: an independent extraction (exactly one of Fields/Groups) that shares the
// outer request's navigation but has its own output file and monitoring.
public sealed class ExtractionBlockConfig
{
    // Label in this block's messages and fallback for the output name; blank = "block_{index}" (1-based).
    public string? Name { get; init; }

    public List<ScrapingField>? Fields { get; init; }
    public List<GroupNode>? Groups { get; init; }

    // Base name (no extension); blank = the sanitized Name. Must be unique across blocks.
    public string? OutputFileName { get; init; }

    // null = shape default (Csv for Fields, Xml for Groups). An explicit value is honored as given.
    public OutputFormat? OutputFormat { get; init; }

    // Per block: each block has its own result set. Rejected on the outer config when Blocks is set.
    public ChangeDetectionConfig? ChangeDetection { get; init; }
    public List<HardeningCheck>? Hardening { get; init; }
}
