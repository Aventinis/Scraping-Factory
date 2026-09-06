namespace ScrapingFactory.Compiler.Backends;

// Issue #122: a capped sample of what a /generate trial run actually
// scraped — built from data PythonScriptVerifier already reads to check
// "at least one row/element" (see ScriptVerificationResult.RowCount), only
// kept instead of discarded when the caller opted in (VerifyAsync's
// includePreview parameter). Never built/returned unless requested, so the
// default (no preview) path allocates nothing extra beyond today.
public sealed class ScriptPreviewData
{
    // "Csv" | "Xml" — mirrors OutputFormat, so the extension knows which of
    // Columns/Rows vs. XmlSample is populated without re-deriving it.
    public required string OutputFormat { get; init; }

    // The same count VerifyAsync already computed for pass/fail (CSV data-row
    // count, or XML descendant-element count) — duplicated here so this
    // object is self-contained and the extension doesn't need to cross-
    // reference RowCount separately.
    public required int TotalCount { get; init; }

    // True when Rows/the XmlSample's top-level elements were capped below
    // the actual total — lets the extension show a "showing N of M" note.
    public required bool Truncated { get; init; }

    // Csv only: header names in the order they appear in output.csv.
    public IReadOnlyList<string>? Columns { get; init; }

    // Csv only: up to PythonScriptVerifier's row cap, each row keyed by
    // column name (matches Columns) rather than a plain positional array —
    // easier for the extension to render as a table without also shipping
    // Columns' order-dependent zip logic client-side.
    public IReadOnlyList<IReadOnlyDictionary<string, string>>? Rows { get; init; }

    // Xml only (Phase A — see PLAN-trial-run-data-preview.md): a pretty-
    // printed, capped fragment of output.xml, shown read-only as text. A
    // structured JSON tree (mirroring the container/API config tree UI) is
    // deliberately out of scope for this phase.
    public string? XmlSample { get; init; }
}
