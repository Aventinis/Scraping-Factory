namespace ScrapingFactory.Compiler.IR;

// Combined mode (Issue #239): one entry in ScrapingConfig.Combined — a
// complete, independent ScrapingConfig (its own Url/mode/engine/browser
// actions/proxy/hardening/etc., all untouched) plus the extra bits Combined
// mode itself needs around it.
public sealed class CombinedComponentConfig
{
    // The merge key this component's own output is written under in the
    // final combined output object (e.g. {"products": [...], "reviews": {...}}).
    // Blank/null defaults to "component_{index}" (1-based) — see Program.cs's
    // /generate handler.
    public string? Name { get; init; }

    public required ScrapingConfig Config { get; init; }

    // One-time login/test values (Issue #43) for THIS component's own
    // FillStep actions, used only for this component's share of the /generate
    // trial-run verification — same trust boundary as the outer, single-mode
    // ScrapingConfig.VerificationValues (never persisted, never reaches the
    // generated script). Kept per-component rather than reusing a single
    // outer field because BrowserActions — and therefore which env var names
    // are even meaningful — lives on each component's own Config, not on the
    // outer Combined request.
    public Dictionary<string, string>? VerificationValues { get; init; }

    // Round-trip only: the saved-configuration id (Issue #141) this
    // component was picked from, if any. Never read during generation —
    // Config above is always what's actually used — but carried through so
    // a saved Combined configuration can be reloaded back into the
    // Combined-mode editor (config-import.js's applyConfigToState) with each
    // component still pointing at its own source saved configuration.
    public long? SavedConfigId { get; init; }
}
