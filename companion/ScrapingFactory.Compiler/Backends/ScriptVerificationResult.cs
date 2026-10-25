namespace ScrapingFactory.Compiler.Backends;

public sealed class ScriptVerificationResult
{
    public bool Success { get; init; }

    // Set whenever Success is false: crash (with stderr), timeout, missing or unparsable output, or zero rows.
    public string? Error { get; init; }

    public int RowCount { get; init; }

    // Only when requested and successful.
    public ScriptPreviewData? Preview { get; init; }

    // Only when requested and successful: the complete output file as the script wrote it (read raw, not rebuilt
    // from Preview), so a download is byte-identical.
    public string? OutputFileContent { get; init; }
    public string? OutputFileName { get; init; }

    // null for text formats; "base64" for the binary table formats (.sqlite/.xlsx).
    public string? OutputFileEncoding { get; init; }

    // VerifyBlocksAsync only: one entry per block in the caller's order. The single-file members above stay unset.
    public IReadOnlyList<BlockVerificationResult>? Blocks { get; init; }
}
