namespace ScrapingFactory.Compiler.IR;

public sealed class ScrapingConfig
{
    public string Version { get; init; } = "1";
    public required string Url { get; init; }
    public List<ScrapingField> Fields { get; init; } = [];

    // Container-Mode: mutually exclusive with Fields (enforced in the
    // /generate endpoint, before ScrapingPlanBuilder ever sees the config).
    // When set, OutputFormat is forced to Xml server-side — see
    // ScrapingPlanBuilder.
    public List<GroupNode>? Groups { get; init; }

    // API-Mode (Issue #53): mutually exclusive with both Fields and Groups
    // (enforced in the /generate endpoint). When set, OutputFormat is forced
    // to Csv and Engine to ScrapingEngine.Api server-side — see
    // ScrapingPlanBuilder.
    public ApiConfig? Api { get; init; }

    public OutputFormat OutputFormat { get; init; } = OutputFormat.Csv;

    // Additive, wire-compatible: existing extension payloads omit this and
    // get Static, today's only behavior. No extension UI to set it yet —
    // reachable only by sending "engine": "Browser" directly.
    public ScrapingEngine Engine { get; init; } = ScrapingEngine.Static;

    // Browser-engine-only action steps (WaitFor/Fill/Click/Scroll, see
    // BrowserAction), executed in order after navigation and before
    // extraction (Fields/Groups/Api alike — see ScrapingPlanBuilder).
    // Rejected server-side unless Engine is Browser (see
    // ScrapingPlanValidator). Null/empty = no actions, today's only
    // behavior for existing payloads.
    public List<BrowserAction>? BrowserActions { get; init; }

    // Base filename (no extension) for the downloaded .py script. Purely
    // cosmetic today — used only in the generated script's "# Run: python
    // X.py" header comment, since the extension names the actual download
    // itself and never asks the companion for it. Sanitized server-side too
    // (see FileNameSanitizer) in case a caller talks to /generate directly.
    // Null/blank falls back to "scraper".
    public string? ScriptFileName { get; init; }

    // Base filename (no extension) for the data file the generated script
    // writes (output.csv/output.xml today) — the extension itself is still
    // chosen by OutputFormat/Container-Mode, only the base name is
    // configurable. Sanitized server-side (see FileNameSanitizer). Null/blank
    // falls back to "output".
    public string? OutputFileName { get; init; }
}

public sealed class ScrapingField
{
    public required string Name { get; init; }
    public required string Selector { get; init; }
    // null = Textinhalt; "href", "src" usw. für Attribut-Extraktion
    public string? Attribute { get; init; }
}

public enum OutputFormat { Csv, Xml }
