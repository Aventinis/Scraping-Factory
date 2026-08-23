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
