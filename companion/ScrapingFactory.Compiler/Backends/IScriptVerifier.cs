using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends;

public interface IScriptVerifier
{
    string LanguageId { get; }

    // outputFormat determines which artifact the verifier expects the
    // script to produce (output.csv vs. output.xml) — additive optional
    // parameter, defaulting to today's only behavior (Csv), so existing
    // callers keep compiling unchanged. outputFileBaseName is the base name
    // (no extension) the script was told to write — must match
    // ScrapingPlan.OutputFileBaseName, the value the code generator actually
    // baked into the script, or verification will look for the wrong file.
    // extraTimeout is added on top of the verifier's own baseline timeout —
    // for a plan whose configured behavior can genuinely take longer than
    // that baseline (e.g. a ScrollStep's MaxIterations × WaitAfterMs), the
    // caller (knowing the plan) asks for the extra headroom the verifier
    // (only ever seeing the rendered script) has no way to infer on its own.
    // extraEnvironmentVariables are set on the verification subprocess only
    // (e.g. one-time login test values, see IR/FillVerificationValues.cs) —
    // never persisted, never part of the script itself.
    // includePreview (Issue #122): when true and verification succeeds, a
    // capped sample of the actual scraped data is kept and returned via
    // ScriptVerificationResult.Preview instead of being discarded — see
    // ScriptPreviewData. Defaults to false (today's exact behavior:
    // read-and-discard, only the row/element count survives).
    // includeOutputFile (Issue #161): when true and verification succeeds,
    // the *complete*, uncapped output file content is kept and returned via
    // ScriptVerificationResult.OutputFileContent/OutputFileName instead of
    // being discarded — independent of includePreview (either, both, or
    // neither may be requested). Defaults to false (today's exact behavior).
    Task<ScriptVerificationResult> VerifyAsync(
        string script, OutputFormat outputFormat = OutputFormat.Csv, string outputFileBaseName = "output",
        TimeSpan extraTimeout = default, IReadOnlyDictionary<string, string>? extraEnvironmentVariables = null,
        bool includePreview = false, bool includeOutputFile = false, CancellationToken ct = default);

    // Issue #182: the Blocks-mode counterpart to VerifyAsync — runs the
    // script exactly once (one subprocess, same as VerifyAsync), but then
    // checks `blocks.Count` output files instead of one, each with its own
    // OutputFormat/OutputFileBaseName. Success requires the process to exit
    // compatibly AND every block to have produced at least one row/element —
    // a single empty/failing block fails the whole call (see
    // ScriptVerificationResult.Error), the same "did it actually work"
    // standard VerifyAsync already holds a single-shape script to, applied
    // per block instead of once. On success, ScriptVerificationResult.Blocks
    // carries one BlockVerificationResult per block, in the same order.
    Task<ScriptVerificationResult> VerifyBlocksAsync(
        string script, IReadOnlyList<BlockOutputSpec> blocks,
        TimeSpan extraTimeout = default, IReadOnlyDictionary<string, string>? extraEnvironmentVariables = null,
        bool includePreview = false, bool includeOutputFile = false, CancellationToken ct = default);
}
