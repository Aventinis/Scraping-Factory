namespace ScrapingFactory.Compiler.IR;

// The /generate request body, exactly as the extension sends it. Every optional property is additive:
// null/false is the behavior from before the option existed. Details per option: docs/design-notes/compiler.md.
//
// Exactly one of Fields / Groups / Api / Combined / Blocks describes what to extract. Rejected by /generate
// (Endpoints/GenerateEndpoint*.cs): AdditionalUrls, Pagination, DiscoveredUrls and Preflight together with Api; most
// per-run options on the outer config of a Combined request (each component carries its own); ChangeDetection and
// Hardening on the outer config of a Blocks request (they are per block).
public sealed class ScrapingConfig
{
    public string Version { get; init; } = "1";
    public required string Url { get; init; }

    // Further start URLs for the same extraction; results go into one output file.
    public List<string>? AdditionalUrls { get; init; }

    public List<ScrapingField> Fields { get; init; } = [];

    // Container mode. Output defaults to Xml (see ScrapingPlanBuilder).
    public List<GroupNode>? Groups { get; init; }

    // API mode. Forces Engine.Api; output defaults to Csv (flat) or Xml (tree).
    public ApiConfig? Api { get; init; }

    public OutputFormat OutputFormat { get; init; } = OutputFormat.Csv;

    public ScrapingEngine Engine { get; init; } = ScrapingEngine.Static;

    // Browser engine only (rejected otherwise); run in order after navigation, before extraction.
    public List<BrowserAction>? BrowserActions { get; init; }

    // One-time values for FillAction env vars, used only by the trial run; never reaches the script.
    public Dictionary<string, string>? VerificationValues { get; init; }

    // Base names (no extension), sanitized by FileNameSanitizer; blank falls back to "scraper" / "output".
    public string? ScriptFileName { get; init; }
    public string? OutputFileName { get; init; }

    // Either one turns the plain-text /generate response into a JSON envelope (script + preview / outputFile).
    public bool? IncludePreview { get; init; }
    public bool? IncludeOutputFile { get; init; }

    // Skips the trial run (structural validation still runs); read from the outer request only.
    public bool? SkipVerification { get; init; }

    public ChangeDetectionConfig? ChangeDetection { get; init; }
    public ProxyConfig? Proxy { get; init; }
    public RequestDelayConfig? RequestDelay { get; init; }

    // Reads Crawl-delay / Request-rate from robots.txt as an extra minimum gap; the larger of the two gaps wins.
    public bool? RespectRobotsDelay { get; init; }

    public RobotsDisallowConfig? RobotsDisallow { get; init; }

    // Appends to the previous output file instead of replacing it (every output format).
    public bool? AppendOutput { get; init; }

    public RetryConfig? Retry { get; init; }

    // Custom request headers for flat/container/Blocks mode (API mode has ApiConfig.Headers); no Template variant.
    public List<ApiHeader>? Headers { get; init; }

    public DeduplicationConfig? Deduplication { get; init; }
    public List<HardeningCheck>? Hardening { get; init; }

    // Fields/Groups only; each start URL paginates independently.
    public PaginationConfig? Pagination { get; init; }

    // Fields/Groups only; additive with AdditionalUrls.
    public DiscoveredUrlsConfig? DiscoveredUrls { get; init; }

    // Fields/Groups only; a single HEAD request that can skip the whole run, never launches a browser.
    public bool? Preflight { get; init; }

    // Browser engine only: keeps the login session in a sidecar file and skips the login actions while it exists.
    public bool? PersistentSession { get; init; }

    // The script reads an editable sidecar XML next to itself (created on first run).
    public bool? ExternalConfig { get; init; }

    // Combined mode: at least two independent components, merged into one JSON object keyed by component name.
    public List<CombinedComponentConfig>? Combined { get; init; }

    // Blocks mode: at least two extraction blocks sharing one navigation, each with its own output file.
    public List<ExtractionBlockConfig>? Blocks { get; init; }

    // Flat-shaped output only (flat Fields, API flat) and container / API tree via flattening; not Combined/Blocks.
    public OutputBlueprintMapping? OutputBlueprint { get; init; }
}

public sealed class ScrapingField
{
    public required string Name { get; init; }

    // May be blank only when Transforms starts with a combineFields/splitField transform (a derived field).
    public string? Selector { get; init; }

    // null = text content; "href", "src", … = attribute value.
    public string? Attribute { get; init; }

    public List<string>? FramePath { get; init; }
    public List<FieldTransform>? Transforms { get; init; }

    // Saves the attribute's URL target next to the output; requires Attribute.
    public bool Download { get; init; }
    public int? MaxDownloadSizeBytes { get; init; }
    public List<string>? AllowedContentTypes { get; init; }

    // Computed (derived fields can read it) but left out of the written output.
    public bool HiddenFromOutput { get; init; }
}

// Sqlite/Xlsx are tables (sheet "Data"); a tree-shaped source is flattened into rows for them.
public enum OutputFormat { Csv, Xml, Json, Sqlite, Xlsx }
