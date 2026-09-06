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
}
