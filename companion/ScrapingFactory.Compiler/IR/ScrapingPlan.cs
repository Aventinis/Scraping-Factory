namespace ScrapingFactory.Compiler.IR;

// Canonical IR consumed by code generators/verifiers: a step sequence
// instead of ScrapingConfig's flat Fields list. Lets future step types
// (WaitFor, Fill, Click, ...) extend the model without touching the wire
// format the extension already speaks — see ScrapingPlanBuilder.
public sealed class ScrapingPlan
{
    public List<ScrapingStep> Steps { get; init; } = [];
    public OutputFormat OutputFormat { get; init; } = OutputFormat.Csv;
    public ScrapingEngine Engine { get; init; } = ScrapingEngine.Static;

    // Already sanitized by FileNameSanitizer in ScrapingPlanBuilder — code
    // generators and PythonScriptVerifier can use these verbatim, no further
    // escaping/validation needed (see ScrapingConfig.ScriptFileName/
    // OutputFileName for what these mean).
    public string ScriptFileName { get; init; } = "scraper";
    public string OutputFileBaseName { get; init; } = "output";

    // Issue #87: mode-independent, carried through unchanged from
    // ScrapingConfig.ChangeDetection by ScrapingPlanBuilder — see
    // IR/ChangeDetectionConfig.cs.
    public ChangeDetectionConfig? ChangeDetection { get; init; }
}
