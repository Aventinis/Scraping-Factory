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

    // Proves the actual point of FillStep/ClickStep: a login flow where
    // credentials are sourced from environment variables at runtime and
    // never appear literally in the generated script. The "backend" here is
    // pure client-side JS reacting to the click (LocalTestServer always
    // serves the same page regardless of method/path), which is enough to
    // prove fill + click + wait-for-success actually happen in order.
    [Fact]
    public async Task LoginFlow_FillsCredentialsFromEnvironmentAndClicksSubmit()
    {
        using var server = new LocalTestServer("""
            <html><body>
            <input id="username" type="text" />
            <input id="password" type="password" />
            <button id="submit" onclick="
              if (document.getElementById('username').value === 'alice' &amp;&amp;
                  document.getElementById('password').value === 's3cret') {
                var el = document.createElement('div');
                el.className = 'welcome';
                el.textContent = 'Welcome, alice';
                document.body.appendChild(el);
              }
            ">Login</button>
            </body></html>
            """);

        const string usernameVar = "SCRAPINGFACTORY_TEST_USERNAME";
        const string passwordVar = "SCRAPINGFACTORY_TEST_PASSWORD";
        Environment.SetEnvironmentVariable(usernameVar, "alice");
        Environment.SetEnvironmentVariable(passwordVar, "s3cret");
        try
        {
            var plan = new ScrapingPlan
            {
                Engine = ScrapingEngine.Browser,
                Steps =
                [
                    new NavigateStep { Url = server.BaseUrl },
                    new FillStep { Selector = "#username", EnvironmentVariableName = usernameVar },
                    new FillStep { Selector = "#password", EnvironmentVariableName = passwordVar },
                    new ClickStep { Selector = "#submit" },
                    new WaitForStep { Selector = ".welcome", TimeoutMs = 5000 },
                    new ExtractStep { Name = "Welcome", Selector = ".welcome" },
                ],
            };
            var script = Generator.Generate(plan);
            Assert.DoesNotContain("alice", script);
            Assert.DoesNotContain("s3cret", script);

            var result = await new PythonScriptVerifier().VerifyAsync(script);

            Assert.True(result.Success, result.Error);
            Assert.Equal(1, result.RowCount);
        }
        finally
        {
            Environment.SetEnvironmentVariable(usernameVar, null);
            Environment.SetEnvironmentVariable(passwordVar, null);
        }
    }
}
