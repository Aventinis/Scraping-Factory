namespace ScrapingFactory.Compiler.Backends;

public sealed class ScriptVerificationResult
{
    public bool Success { get; init; }

    // Set whenever Success is false: process crash (with stderr excerpt),
    // timeout, missing/unparsable output.csv, or zero data rows.
    public string? Error { get; init; }

    public int RowCount { get; init; }

    // Issue #122: only set when the caller opted in (VerifyAsync's
    // includePreview parameter) and Success is true — see ScriptPreviewData.
    public ScriptPreviewData? Preview { get; init; }

    // Issue #161: only set when the caller opted in (VerifyAsync's
    // includeOutputFile parameter) and Success is true — the complete,
    // uncapped content of the trial run's own output.csv/.xml/.json,
    // read raw (not re-derived from Preview's capped/re-serialized sample)
    // so what the user downloads is byte-for-byte what the script wrote.
    public string? OutputFileContent { get; init; }

    // The output file's own name (e.g. "output.csv") — mirrors whichever
    // ScrapingPlan.OutputFileBaseName/OutputFormat combination VerifyAsync
    // was called with, so the extension can offer the same filename back to
    // the user without re-deriving the extension itself.
    public string? OutputFileName { get; init; }

    // Issue #182: only set by VerifyBlocksAsync (never by VerifyAsync) when
    // Success is true — one entry per block, in the same order the caller's
    // own block list was given in. RowCount/Preview/OutputFileContent/
    // OutputFileName above stay unset on the outer result in this case;
    // they only ever describe a single-shape run's one output file.
    public IReadOnlyList<BlockVerificationResult>? Blocks { get; init; }
}
