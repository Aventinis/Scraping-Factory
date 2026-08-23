namespace ScrapingFactory.Compiler.Backends.Python;

public sealed class ScriptVerificationResult
{
    public bool Success { get; init; }

    // Set whenever Success is false: process crash (with stderr excerpt),
    // timeout, missing/unparsable output.csv, or zero data rows.
    public string? Error { get; init; }

    public int RowCount { get; init; }
}
