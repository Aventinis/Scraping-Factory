using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class LanguageModuleRegistryTests
{
    private readonly LanguageModuleRegistry _registry = new();

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
}
