using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class LanguageModuleRegistryTests
{
    private readonly LanguageModuleRegistry _registry = new();

    // Discoverable via LanguageModuleRegistry's own reflection scan (an
    // all-optional-parameters constructor, same requirement as
    // PythonScriptVerifier) — lets these tests prove the generic
    // ctorOverrides substitution mechanism itself, independent of any real
    // backend's own parameter names/types.
    private sealed class FakeVerifier(string? label = null, TimeSpan? timeout = null) : IScriptVerifier
    {
        public string LanguageId => "fake";
        public string? Label => label;
        public TimeSpan? Timeout => timeout;

        public Task<ScriptVerificationResult> VerifyAsync(
            string script, OutputFormat outputFormat = OutputFormat.Csv, string outputFileBaseName = "output",
            TimeSpan extraTimeout = default, IReadOnlyDictionary<string, string>? extraEnvironmentVariables = null,
            CancellationToken ct = default) =>
            throw new NotImplementedException();
    }

    [Fact]
    public void ResolveCodeGenerator_PythonStatic_ReturnsPythonCodeGenerator()
    {
        var generator = _registry.ResolveCodeGenerator("python", ScrapingEngine.Static);
        Assert.IsType<PythonCodeGenerator>(generator);
    }

    [Fact]
    public void ResolveCodeGenerator_PythonBrowser_ReturnsPythonPlaywrightCodeGenerator()
    {
        var generator = _registry.ResolveCodeGenerator("python", ScrapingEngine.Browser);
        Assert.IsType<PythonPlaywrightCodeGenerator>(generator);
    }

    [Fact]
    public void ResolveScriptVerifier_Python_ReturnsPythonScriptVerifier()
    {
        var verifier = _registry.ResolveScriptVerifier("python");
        Assert.IsType<PythonScriptVerifier>(verifier);
    }

    [Fact]
    public void ResolveCodeGenerator_UnknownLanguage_Throws()
    {
        Assert.Throws<InvalidOperationException>(() => _registry.ResolveCodeGenerator("cobol", ScrapingEngine.Static));
    }

    [Fact]
    public void ResolveScriptVerifier_UnknownLanguage_Throws()
    {
        Assert.Throws<InvalidOperationException>(() => _registry.ResolveScriptVerifier("cobol"));
    }

    [Fact]
    public void CtorOverrides_MatchingParameterName_OverridesConstructorDefault()
    {
        var registry = new LanguageModuleRegistry(
            typeof(FakeVerifier).Assembly, new Dictionary<string, object?> { ["label"] = "custom-label" });

        var verifier = Assert.IsType<FakeVerifier>(registry.ResolveScriptVerifier("fake"));
        Assert.Equal("custom-label", verifier.Label);
        Assert.Null(verifier.Timeout);
    }

    [Fact]
    public void CtorOverrides_TimeSpanParameter_Substitutes()
    {
        var registry = new LanguageModuleRegistry(
            typeof(FakeVerifier).Assembly, new Dictionary<string, object?> { ["timeout"] = TimeSpan.FromSeconds(99) });

        var verifier = Assert.IsType<FakeVerifier>(registry.ResolveScriptVerifier("fake"));
        Assert.Equal(TimeSpan.FromSeconds(99), verifier.Timeout);
    }

    [Fact]
    public void CtorOverrides_NoMatchingKey_KeepsConstructorDefault()
    {
        var registry = new LanguageModuleRegistry(
            typeof(FakeVerifier).Assembly, new Dictionary<string, object?> { ["someUnrelatedKey"] = "x" });

        var verifier = Assert.IsType<FakeVerifier>(registry.ResolveScriptVerifier("fake"));
        Assert.Null(verifier.Label);
    }

    [Fact]
    public void CtorOverrides_Null_BehavesLikeNoOverrides()
    {
        var registry = new LanguageModuleRegistry(typeof(FakeVerifier).Assembly, ctorOverrides: null);

        var verifier = Assert.IsType<FakeVerifier>(registry.ResolveScriptVerifier("fake"));
        Assert.Null(verifier.Label);
        Assert.Null(verifier.Timeout);
    }
}
