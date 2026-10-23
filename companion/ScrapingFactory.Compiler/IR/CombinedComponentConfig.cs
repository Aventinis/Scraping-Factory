namespace ScrapingFactory.Compiler.IR;

// One entry of ScrapingConfig.Combined: a complete, independent ScrapingConfig plus what Combined mode needs
// around it.
public sealed class CombinedComponentConfig
{
    // Key of this component's output in the merged object; blank = "component_{index}" (1-based).
    public string? Name { get; init; }

    public required ScrapingConfig Config { get; init; }

    // One-time Fill values for this component's trial run (kept per component because BrowserActions, and so the
    // meaningful env var names, live on its Config). Never reaches the script.
    public Dictionary<string, string>? VerificationValues { get; init; }

    // Round-tripping only: the saved configuration this component was picked from. Config is what is used.
    public long? SavedConfigId { get; init; }
}
