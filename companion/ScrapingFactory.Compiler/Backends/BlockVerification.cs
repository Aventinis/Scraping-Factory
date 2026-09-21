using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends;

// Issue #182: one block's own output identity, as far as verification is
// concerned — the same (OutputFormat, OutputFileBaseName) pair VerifyAsync's
// own two parameters already carry for the single-shape case, just one per
// block instead of one for the whole plan. Name is carried through purely so
// IScriptVerifier.VerifyBlocksAsync can prefix a per-block failure with which
// block it came from, and so the /generate response can key its own
// per-block envelope by the same name the wire format already uses.
public sealed record BlockOutputSpec(string Name, OutputFormat OutputFormat, string OutputFileBaseName);

// One block's own verification outcome — the per-block analog of
// ScriptVerificationResult's RowCount/Preview/OutputFileContent/
// OutputFileName. A block that itself produced no data (or failed to parse)
// fails the *whole* VerifyBlocksAsync call rather than being reported here
// as an unsuccessful entry — see VerifyBlocksAsync's own doc comment — so
// this type carries no Success/Error of its own.
public sealed class BlockVerificationResult
{
    public required string Name { get; init; }
    public int RowCount { get; init; }
    public ScriptPreviewData? Preview { get; init; }
    public string? OutputFileContent { get; init; }
    public string? OutputFileName { get; init; }
}
