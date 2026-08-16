namespace ScrapingFactory.Compiler.IR;

public sealed class ScrapingConfig
{
    public string Version { get; init; } = "1";
    public required string Url { get; init; }
    public List<ScrapingField> Fields { get; init; } = [];
    public OutputFormat OutputFormat { get; init; } = OutputFormat.Csv;
}

public sealed class ScrapingField
{
    public required string Name { get; init; }
    public required string Selector { get; init; }
    // null = Textinhalt; "href", "src" usw. für Attribut-Extraktion
    public string? Attribute { get; init; }
}

public enum OutputFormat { Csv }
