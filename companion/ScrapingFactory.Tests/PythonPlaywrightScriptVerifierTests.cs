using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Real end-to-end tests for the Browser engine: spawns an actual python3
// subprocess that launches a real Chromium via Playwright against
// LocalTestServer — the same "prove the exact artifact works" philosophy
// as PythonScriptVerifierTests, just for the Playwright-generated script.
// Requires playwright + a downloaded Chromium build on the machine running
// the tests (see CLAUDE.md runtime prerequisites).
public class PythonPlaywrightScriptVerifierTests
{
    private static readonly PythonPlaywrightCodeGenerator Generator = new();

    [Fact]
    public async Task ScriptThatFindsData_Succeeds()
    {
        using var server = new LocalTestServer(
            "<html><body><ul><li class='item'>A</li><li class='item'>B</li></ul></body></html>");
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps = [new NavigateStep { Url = server.BaseUrl }, new ExtractStep { Name = "Item", Selector = ".item" }],
        };
        var script = Generator.Generate(plan);

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.True(result.Success);
        Assert.Null(result.Error);
        Assert.Equal(2, result.RowCount);
    }

    // The whole point of the Browser engine: content inserted by JavaScript
    // after the initial page load. A requests+BeautifulSoup script (Static
    // engine) could never see this — it never runs the <script> tag.
    [Fact]
    public async Task WaitForStep_ExtractsContentInsertedByJavaScriptAfterLoad()
    {
        using var server = new LocalTestServer("""
            <html><body>
            <div id="container"></div>
            <script>
              setTimeout(function () {
                var el = document.createElement('div');
                el.className = 'item';
                el.textContent = 'Loaded';
                document.getElementById('container').appendChild(el);
              }, 1500);
            </script>
            </body></html>
            """);
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Url = server.BaseUrl },
                new WaitForStep { Selector = ".item", TimeoutMs = 5000 },
                new ExtractStep { Name = "Item", Selector = ".item" },
            ],
        };
        var script = Generator.Generate(plan);

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.True(result.Success);
        Assert.Equal(1, result.RowCount);
    }
}
