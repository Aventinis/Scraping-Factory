namespace ScrapingFactory.Compiler.Backends;

// A capped sample of what a trial run scraped, kept (instead of discarded after the row-count check) only when
// the caller asked for it.
public sealed class ScriptPreviewData
{
    // "Csv" | "Xml" | "Json". Tells the extension which members are set: Columns/Rows (Csv, and Json's flat array)
    // or XmlSample/JsonSample (trees).
    public required string OutputFormat { get; init; }

    // The count verification used for pass/fail (data rows, or descendant elements).
    public required int TotalCount { get; init; }

    // Rows / top-level elements were capped below TotalCount.
    public required bool Truncated { get; init; }

    // Column names in file order.
    public IReadOnlyList<string>? Columns { get; init; }

    // Capped rows keyed by column name.
    public IReadOnlyList<IReadOnlyDictionary<string, string>>? Rows { get; init; }

    // Pretty-printed, capped fragment of output.xml, shown read-only.
    public string? XmlSample { get; init; }

    // The same for output.json in its tree shape.
    public string? JsonSample { get; init; }
}
