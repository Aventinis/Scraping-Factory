using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends;

public interface IScriptVerifier
{
    string LanguageId { get; }

    // outputFormat picks the artifact to expect; outputFileBaseName must equal ScrapingPlan.OutputFileBaseName (what
    // the generator baked into the script). extraTimeout is added to the baseline for plans that legitimately run
    // longer (the caller knows the plan, the verifier only sees the script). extraEnvironmentVariables are set on
    // the subprocess only (one-time login test values), never in the script. includePreview / includeOutputFile
    // keep a capped sample / the complete output file instead of discarding it; independent of each other.
    Task<ScriptVerificationResult> VerifyAsync(
        string script, OutputFormat outputFormat = OutputFormat.Csv, string outputFileBaseName = "output",
        TimeSpan extraTimeout = default, IReadOnlyDictionary<string, string>? extraEnvironmentVariables = null,
        bool includePreview = false, bool includeOutputFile = false, CancellationToken ct = default);

    // Blocks mode: runs the script once and checks one output file per block. A single empty or failing block
    // fails the whole call; on success ScriptVerificationResult.Blocks has one entry per block, in order.
    Task<ScriptVerificationResult> VerifyBlocksAsync(
        string script, IReadOnlyList<BlockOutputSpec> blocks,
        TimeSpan extraTimeout = default, IReadOnlyDictionary<string, string>? extraEnvironmentVariables = null,
        bool includePreview = false, bool includeOutputFile = false, CancellationToken ct = default);
}
