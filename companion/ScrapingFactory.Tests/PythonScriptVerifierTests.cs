using System.Net;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// These tests actually spawn python3 and run the generated script — the
// whole point of PythonScriptVerifier is to prove the real artifact works,
// not to simulate it. Requires python3 + requests + beautifulsoup4 on the
// machine running the tests (same requirement the Companion App itself now
// has at runtime).
public class PythonScriptVerifierTests
{
    private static string GenerateScript(string url, params (string Name, string Selector)[] fields)
    {
        var steps = new List<ScrapingStep> { new NavigateStep { Url = url } };
        steps.AddRange(fields.Select(f => (ScrapingStep)new ExtractStep { Name = f.Name, Selector = f.Selector }));

        return new PythonCodeGenerator().Generate(new ScrapingPlan { Steps = steps });
    }

    [Fact]
    public async Task ScriptThatFindsData_Succeeds()
    {
        using var server = new LocalTestServer(
            "<html><body><ul><li class='item'>A</li><li class='item'>B</li></ul></body></html>");
        var script = GenerateScript(server.BaseUrl, ("Item", ".item"));

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.True(result.Success);
        Assert.Null(result.Error);
        Assert.Equal(2, result.RowCount);
    }

    [Fact]
    public async Task SelectorMatchingNothing_FailsWithZeroDataRows()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var script = GenerateScript(server.BaseUrl, ("Preis", ".price"));

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.False(result.Success);
        Assert.Contains("keine Daten", result.Error);
        Assert.Equal(0, result.RowCount);
    }

    [Fact]
    public async Task UnreachablePage_FailsWithScriptErrorOutput()
    {
        // Port 1 is a privileged, essentially-never-listening port — the
        // script's requests.get() should fail fast with a connection error.
        var script = GenerateScript("http://127.0.0.1:1/nope", ("Titel", "h1"));

        var result = await new PythonScriptVerifier(timeout: TimeSpan.FromSeconds(15)).VerifyAsync(script);

        Assert.False(result.Success);
        Assert.NotNull(result.Error);
    }

    [Fact]
    public async Task PageReturning500_FailsWithScriptErrorOutput()
    {
        using var server = new LocalTestServer("server error", HttpStatusCode.InternalServerError);
        var script = GenerateScript(server.BaseUrl, ("Titel", "h1"));

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.False(result.Success);
        Assert.NotNull(result.Error);
    }

    [Fact]
    public async Task MissingPythonExecutable_FailsGracefully()
    {
        var verifier = new PythonScriptVerifier("definitely-not-a-real-python-executable-xyz");
        var script = GenerateScript("https://example.com", ("Titel", "h1"));

        var result = await verifier.VerifyAsync(script);

        Assert.False(result.Success);
        Assert.Contains("Kein Python-Interpreter gefunden", result.Error);
    }
}
