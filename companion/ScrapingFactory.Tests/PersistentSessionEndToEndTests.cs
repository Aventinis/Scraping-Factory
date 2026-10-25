using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #175: real end-to-end proof that session persistence actually skips
// the login-flow browser actions on a run that reuses a previously saved
// session — this is inherently a two-run, real-subprocess concern (the same
// "PythonScriptVerifier's single always-fresh-temp-directory trial can never
// exercise this" reasoning as HardeningBaselineEndToEndTests) that no
// template-string assertion in PythonPlaywrightCodeGeneratorTests could
// prove. The second run deliberately omits the login credential env vars
// entirely — if the skip logic were broken and the login actions ran
// anyway, the script would fail fast with EXIT_MISSING_ENV_VAR (78) instead
// of succeeding, making this a strong (not just incidental) signal.
public class PersistentSessionEndToEndTests
{
    // Serves a login form when no session cookie is present, and the "real"
    // protected content once one is — the login form's submit button sets
    // the cookie via document.cookie (rather than a Set-Cookie response
    // header, which LocalTestServer doesn't expose) and navigates back to
    // "/", which is enough for Playwright's own cookie jar (and therefore
    // storage_state) to pick it up exactly like a server-set cookie would.
    private const string LoginHtml = """
        <html><body>
        <input id="username" />
        <input id="password" />
        <button id="submit" onclick="document.cookie='session=abc123; path=/'; window.location.href='/';">Login</button>
        </body></html>
        """;

    private const string ContentHtml = "<html><body><h1 class='item'>Secret Content</h1></body></html>";

    private static LocalTestServerResponse Responder(System.Net.HttpListenerRequest request)
    {
        var cookieHeader = request.Headers["Cookie"];
        var loggedIn = cookieHeader is not null && cookieHeader.Contains("session=abc123");
        return new LocalTestServerResponse(loggedIn ? ContentHtml : LoginHtml, "text/html; charset=utf-8");
    }

    private static ScrapingPlan LoginPlanWithPersistentSession(string baseUrl) => new()
    {
        Engine = ScrapingEngine.Browser,
        PersistentSession = true,
        Steps =
        [
            new NavigateStep { Urls = [baseUrl] },
            new FillStep { Selector = "#username", EnvironmentVariableName = "SF_TEST_USERNAME" },
            new FillStep { Selector = "#password", EnvironmentVariableName = "SF_TEST_PASSWORD" },
            new ClickStep { Selector = "#submit" },
            new WaitForStep { Selector = "h1.item", TimeoutMs = 5000 },
            new ExtractStep { Name = "Content", Selector = "h1.item" },
        ],
    };

    [Fact]
    public async Task FirstRun_NoSavedSession_PerformsLoginAndSavesSessionState()
    {
        using var server = new LocalTestServer(Responder);
        var script = new PythonPlaywrightCodeGenerator().Generate(LoginPlanWithPersistentSession(server.BaseUrl));

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-persistent-session-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            var env = new Dictionary<string, string> { ["SF_TEST_USERNAME"] = "user", ["SF_TEST_PASSWORD"] = "pass" };

            var (exit, stderr) = await ScriptRunner.RunAsync(scriptPath, workDir, env);

            Assert.Equal(0, exit);
            Assert.Empty(stderr);
            var lines = await File.ReadAllLinesAsync(Path.Combine(workDir, "output.csv"));
            Assert.Equal(2, lines.Length); // header + one data row
            Assert.Contains("Secret Content", lines[1]);
            Assert.True(File.Exists(Path.Combine(workDir, "output.csv.session-state.json")));
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task SecondRun_SavedSessionExists_SkipsLoginActionsEvenWithoutCredentials()
    {
        using var server = new LocalTestServer(Responder);
        var script = new PythonPlaywrightCodeGenerator().Generate(LoginPlanWithPersistentSession(server.BaseUrl));

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-persistent-session-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);

            // First run establishes the session (credentials provided).
            var firstRunEnv = new Dictionary<string, string> { ["SF_TEST_USERNAME"] = "user", ["SF_TEST_PASSWORD"] = "pass" };
            var (firstExit, _) = await ScriptRunner.RunAsync(scriptPath, workDir, firstRunEnv);
            Assert.Equal(0, firstExit);
            var sessionStatePath = Path.Combine(workDir, "output.csv.session-state.json");
            Assert.True(File.Exists(sessionStatePath));

            // Second run: deliberately NO credential env vars. If the skip
            // logic were broken and the Fill steps ran anyway, _require_env
            // would exit 78 immediately instead of succeeding.
            var (secondExit, secondStderr) = await ScriptRunner.RunAsync(scriptPath, workDir, new Dictionary<string, string>());

            Assert.Equal(0, secondExit);
            Assert.Empty(secondStderr);
            var lines = await File.ReadAllLinesAsync(Path.Combine(workDir, "output.csv"));
            Assert.Equal(2, lines.Length);
            Assert.Contains("Secret Content", lines[1]);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }
}
