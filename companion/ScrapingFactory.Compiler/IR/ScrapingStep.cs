namespace ScrapingFactory.Compiler.IR;

public abstract class ScrapingStep
{
}

public sealed class NavigateStep : ScrapingStep
{
    public required string Url { get; init; }
}

public sealed class ExtractStep : ScrapingStep
{
    public required string Name { get; init; }
    public required string Selector { get; init; }

    // null = Textinhalt; "href", "src" usw. für Attribut-Extraktion
    public string? Attribute { get; init; }
}

// Browser-engine only: waits for a selector to appear before continuing,
// for content that's inserted client-side after the initial page load.
public sealed class WaitForStep : ScrapingStep
{
    public required string Selector { get; init; }
    public int TimeoutMs { get; init; } = 5000;
}

// Browser-engine only: fills a form field, e.g. a login form's username or
// password input. The value is never embedded literally in the generated
// script — always sourced from an environment variable at runtime, so
// credentials don't end up in plain text in a saved/shared script.
public sealed class FillStep : ScrapingStep
{
    public required string Selector { get; init; }
    public required string EnvironmentVariableName { get; init; }
}

// Browser-engine only: clicks an element, e.g. a login form's submit
// button. Deliberately just a click — anything that needs to happen after
// (e.g. waiting for the resulting page) is a separate WaitForStep.
public sealed class ClickStep : ScrapingStep
{
    public required string Selector { get; init; }
}
