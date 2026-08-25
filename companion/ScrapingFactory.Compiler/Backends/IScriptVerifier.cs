using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends;

public interface IScriptVerifier
{
    string LanguageId { get; }

    // outputFormat determines which artifact the verifier expects the
    // script to produce (output.csv vs. output.xml) — additive optional
    // parameter, defaulting to today's only behavior (Csv), so existing
    // callers keep compiling unchanged.
    Task<ScriptVerificationResult> VerifyAsync(
        string script, OutputFormat outputFormat = OutputFormat.Csv, CancellationToken ct = default);
}
