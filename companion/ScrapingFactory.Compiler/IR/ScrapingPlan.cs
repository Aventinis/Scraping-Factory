namespace ScrapingFactory.Compiler.IR;

// Canonical IR consumed by code generators/verifiers: a step sequence
// instead of ScrapingConfig's flat Fields list. Lets future step types
// (WaitFor, Fill, Click, ...) extend the model without touching the wire
// format the extension already speaks — see ScrapingPlanBuilder.
public sealed class ScrapingPlan
{
    public List<ScrapingStep> Steps { get; init; } = [];
    public OutputFormat OutputFormat { get; init; } = OutputFormat.Csv;
}
