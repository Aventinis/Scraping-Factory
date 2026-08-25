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

    public OutputFormat OutputFormat { get; init; } = OutputFormat.Csv;

    // Additive, wire-compatible: existing extension payloads omit this and
    // get Static, today's only behavior. No extension UI to set it yet —
    // reachable only by sending "engine": "Browser" directly.
    public ScrapingEngine Engine { get; init; } = ScrapingEngine.Static;
}

public sealed class ScrapingField
{
    public required string Name { get; init; }
    public required string Selector { get; init; }
    // null = Textinhalt; "href", "src" usw. für Attribut-Extraktion
    public string? Attribute { get; init; }
}

public enum OutputFormat { Csv, Xml }
