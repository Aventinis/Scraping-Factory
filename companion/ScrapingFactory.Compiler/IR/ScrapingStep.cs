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
