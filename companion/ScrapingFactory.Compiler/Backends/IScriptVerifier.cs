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
    Task<ScriptVerificationResult> VerifyAsync(
        string script, OutputFormat outputFormat = OutputFormat.Csv, string outputFileBaseName = "output",
        CancellationToken ct = default);
}
