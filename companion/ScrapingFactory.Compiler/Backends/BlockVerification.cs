using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends;

// One block's output identity, the per-block form of VerifyAsync's (outputFormat, outputFileBaseName). Name
// prefixes a per-block failure and keys the /generate response.
public sealed record BlockOutputSpec(string Name, OutputFormat OutputFormat, string OutputFileBaseName);

// One block's outcome. A block without data fails the whole VerifyBlocksAsync call, so there is no Success/Error here.
public sealed class BlockVerificationResult
{
    public required string Name { get; init; }
    public int RowCount { get; init; }
    public ScriptPreviewData? Preview { get; init; }
    public string? OutputFileContent { get; init; }
    public string? OutputFileName { get; init; }
}
