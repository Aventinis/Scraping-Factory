namespace ScrapingFactory.Compiler.IR;

public sealed class ScrapingConfig
{
    public string Version { get; init; } = "1";
    public required string Url { get; init; }

    // Issue #83: extra start URLs the same Fields/Groups extraction config
    // runs against, in addition to Url — results are combined into one
    // output file (see ScrapingPlanBuilder/NavigateStep.Urls). Additive,
    // wire-compatible: null/empty is today's exact single-URL behavior.
    // Mutually exclusive with Api (enforced in the /generate endpoint) —
    // Api mode builds its own request URL from UrlTemplate/Parameters and
    // never consumes the page-scraping start URL at all, so a URL list here
    // would silently do nothing rather than express what the caller intended.
    public List<string>? AdditionalUrls { get; init; }

    public List<ScrapingField> Fields { get; init; } = [];

    // Container-Mode: mutually exclusive with Fields (enforced in the
    // /generate endpoint, before ScrapingPlanBuilder ever sees the config).
    // When set, OutputFormat is forced to Xml server-side, unless the caller
    // explicitly asked for Json (Issue #86) — see ScrapingPlanBuilder.
    public List<GroupNode>? Groups { get; init; }

    // API-Mode (Issue #53): mutually exclusive with both Fields and Groups
    // (enforced in the /generate endpoint). When set, Engine is forced to
    // ScrapingEngine.Api server-side, and OutputFormat is forced to Csv/Xml
    // depending on the response shape (flat/tree, see below), unless the
    // caller explicitly asked for Json (Issue #86) — see ScrapingPlanBuilder.
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

    // One-time, verification-only values for FillAction.EnvironmentVariableName
    // (login credentials etc.), keyed by env var name. Used only for the
    // /generate trial-run subprocess (PythonScriptVerifier) — never reaches
    // ScrapingPlan/the code generator/the generated script; FillAction stays
    // env-var-only by design (see IR/FillVerificationValues.cs).
    public Dictionary<string, string>? VerificationValues { get; init; }

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

    // Issue #122: opt-in trial-run data preview. When true, /generate's
    // trial run keeps a capped sample of the CSV rows/XML elements it reads
    // to check "at least one data row" anyway (see PythonScriptVerifier),
    // and the success response becomes a JSON envelope (script + preview)
    // instead of the plain script text — see Program.cs's /generate handler.
    // Additive, wire-compatible: null/false is today's exact behavior.
    public bool? IncludePreview { get; init; }

    // Issue #161: opt-in full trial-run output download. When true,
    // /generate's trial run keeps the *complete*, uncapped CSV/XML/Json file
    // it already wrote to check "at least one data row" anyway (see
    // PythonScriptVerifier) and the success response becomes a JSON envelope
    // (script + outputFile) instead of the plain script text — same
    // envelope-triggering mechanism as IncludePreview above, just carrying
    // the full file instead of a capped sample. Additive, wire-compatible:
    // null/false is today's exact behavior. Independent of IncludePreview —
    // either, both, or neither may be requested in the same call.
    public bool? IncludeOutputFile { get; init; }

    // Issue #87: opt-in change-detection + notification, mode-independent
    // (Fields/Groups/Api alike) — see IR/ChangeDetectionConfig.cs. Null is
    // today's exact behavior (no previous-run comparison, no notification).
    public ChangeDetectionConfig? ChangeDetection { get; init; }

    // Issue #88: opt-in proxy support, mode-independent (Fields/Groups/Api
    // alike) — see IR/ProxyConfig.cs. Null is today's exact behavior (direct
    // connection, no proxying).
    public ProxyConfig? Proxy { get; init; }

    // Issue #129: opt-in script hardening checks, mode-independent
    // (Fields/Groups/Api alike) — see IR/HardeningCheck.cs. Null/empty is
    // today's exact behavior (the generated script never re-checks its own
    // result, byte-for-byte the same script as before this existed).
    public List<HardeningCheck>? Hardening { get; init; }

    // Issue #174: opt-in classic multi-page pagination (page 1, 2, 3, … via
    // a "next" link or a page-number URL template) — see IR/PaginationConfig.cs.
    // Applies to Fields/Groups alike; mutually exclusive with Api (enforced
    // in Program.cs's /generate handler, same reasoning as AdditionalUrls
    // above — Api mode never reads the page-scraping start URL at all, so
    // this would silently do nothing there). Composes with AdditionalUrls:
    // each start URL (Url + every entry in AdditionalUrls) paginates onward
    // independently. Null is today's exact behavior (a single fetch per
    // start URL, no further pages followed).
    public PaginationConfig? Pagination { get; init; }

    // Issue #175: opt-in persistent session/cookie handling, Browser-engine
    // only (rejected server-side otherwise, same as WaitFor/Fill/Click/
    // Scroll — see ScrapingPlanValidator). When true, the generated script
    // saves its Playwright context's storage_state (cookies/localStorage) to
    // a sidecar file next to its own output after every run, and — once
    // that file exists from a previous run — skips the configured login-flow
    // browser actions (WaitFor/Fill/Click/Scroll) entirely on the next run,
    // going straight from Navigate to extraction instead. Null/false is
    // today's exact behavior (a fresh, empty browser context every run).
    public bool? PersistentSession { get; init; }

    // Issue #178: opt-in external XML config file. When true, the generated
    // script self-creates (on first run, if missing) a small sidecar XML file
    // next to itself, and re-reads it on every subsequent run — letting a
    // non-technical user tweak the start URL(s), the output filename, a flat
    // field's output name, or a fixed-value-list API parameter's values,
    // without touching the .py file or reopening the extension. A missing
    // file is not an error (a fresh one is written); a malformed/stale one
    // is a clean, English error naming exactly what's wrong plus a dedicated
    // exit code, never a raw Python traceback — see the Python templates for
    // the runtime side of this. Null/false is today's exact behavior (no
    // extra file, nothing re-read at runtime).
    public bool? ExternalConfig { get; init; }

    // Combined mode (Issue #239): mutually exclusive with Fields/Groups/Api
    // AND with AdditionalUrls/Pagination/BrowserActions/ChangeDetection/
    // Proxy/Hardening/PersistentSession/ExternalConfig on THIS (outer)
    // config — all of those are component-level concerns only (each
    // CombinedComponentConfig.Config carries its own). At least two
    // components required; a component whose own Config.Combined is set is
    // rejected (no nesting) — see Program.cs's /generate handler for all of
    // the above. Each component is generated through the exact same
    // pipeline a standalone request would use, then forced to
    // OutputFormat.Json (see ScrapingPlan.With) so every component's output
    // can be merged into one combined JSON object, keyed by component name.
    public List<CombinedComponentConfig>? Combined { get; init; }
}

public sealed class ScrapingField
{
    public required string Name { get; init; }
    public required string Selector { get; init; }
    // null = text content; "href", "src" etc. for attribute extraction
    public string? Attribute { get; init; }

    // See ExtractStep.FramePath — same meaning, just the wire-format mirror.
    public List<string>? FramePath { get; init; }

    // See ExtractStep.Transforms (Issue #84) — same meaning, just the
    // wire-format mirror.
    public List<FieldTransform>? Transforms { get; init; }
}

// Json (Issue #86) is a third, user-choosable alternative to Csv/Xml for
// every mode — a flat list-of-records dump for Fields/API-flat, a nested
// object mirroring the group/API tree for Groups/API-tree. See
// ScrapingPlanBuilder for exactly when each mode honors it vs. still forcing
// its own default.
public enum OutputFormat { Csv, Xml, Json }
