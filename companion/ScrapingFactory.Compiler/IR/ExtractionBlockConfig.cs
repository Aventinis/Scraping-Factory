namespace ScrapingFactory.Compiler.IR;

// Issue #182: one entry in ScrapingConfig.Blocks — an independent extraction
// (Fields or Groups, mutually exclusive within the block, enforced in the
// /generate endpoint) sharing the outer request's navigation (Url/
// AdditionalUrls/Engine/BrowserActions/Proxy/PersistentSession/Pagination —
// see ScrapingConfig.Blocks for why Pagination specifically stays
// outer-level rather than per-block), but with its own output file and its
// own monitoring config.
public sealed class ExtractionBlockConfig
{
    // The output filename base's own fallback and the label shown in this
    // block's own hardening/change-detection messages. Blank/null defaults
    // to "block_{index}" (1-based) — see Program.cs's /generate handler,
    // same convention as CombinedComponentConfig.Name.
    public string? Name { get; init; }

    public List<ScrapingField>? Fields { get; init; }

    // Mutually exclusive with Fields within this one block (enforced in the
    // /generate endpoint, same style as the outer Fields/Groups/Api check) —
    // exactly one of the two must be a non-empty list.
    public List<GroupNode>? Groups { get; init; }

    // Base filename (no extension) for this block's own output file.
    // Blank/null falls back to the sanitized block Name (see
    // ScrapingPlanBuilder). Must be unique across every block in the same
    // request after sanitization (enforced in ScrapingPlanValidator) — two
    // blocks silently overwriting each other's output would defeat the
    // entire point of this feature.
    public string? OutputFileName { get; init; }

    // Null = shape default (Csv for Fields, Xml for Groups — the same rule
    // ScrapingConfig.OutputFormat itself follows for the single-shape case),
    // overridable per block, including to Json. Unlike the single-shape
    // case, an explicit Csv/Xml set here is honored as-is rather than only
    // ever yielding to an explicit Json request — every block is
    // independent, so there's no single outer OutputFormat value for this
    // one to defer to.
    public OutputFormat? OutputFormat { get; init; }

    // Issue #87/#129: per-block, unlike the single-shape case — each block
    // produces its own independent result set, so "did the data change" and
    // "does the result look healthy" are naturally per-block questions
    // rather than one shared answer for the whole run. Rejected at the outer
    // (ScrapingConfig) level when Blocks is set — see ScrapingConfig.Blocks.
    public ChangeDetectionConfig? ChangeDetection { get; init; }
    public List<HardeningCheck>? Hardening { get; init; }
}
