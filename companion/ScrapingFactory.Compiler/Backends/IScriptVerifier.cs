namespace ScrapingFactory.Compiler.Backends;

public interface IScriptVerifier
{
    string LanguageId { get; }

    Task<ScriptVerificationResult> VerifyAsync(string script, CancellationToken ct = default);
}
