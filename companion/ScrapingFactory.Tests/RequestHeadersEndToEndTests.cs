using System.Xml.Linq;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #226: real end-to-end proof that configured request headers actually
// reach the target server — for the static engine (requests), the Browser
// engine (Playwright's extra_http_headers / user_agent) and every shape
// (flat, container, Blocks). The page served by the local test server echoes
// the headers it received into the HTML, so the scraped output itself shows
// what arrived; a black-box "did /generate succeed" check couldn't tell a
// header that was sent from one that was silently dropped.
public class RequestHeadersEndToEndTests : IDisposable
{
    private readonly string _workDir = Directory.CreateTempSubdirectory("scrapingfactory-request-headers-test-").FullName;

    public void Dispose() => Directory.Delete(_workDir, recursive: true);

    private async Task<(int Exit, string Stderr)> RunAsync(string script, IReadOnlyDictionary<string, string>? env = null)
    {
        var scriptPath = Path.Combine(_workDir, "scraper.py");
        await File.WriteAllTextAsync(scriptPath, script);
        var (exit, _, stderr) = await ScriptRunner.RunAsync(scriptPath, _workDir, env, timeout: TimeSpan.FromSeconds(90));
        return (exit, stderr);
    }

    private string[] ReadLines(string fileName)
    {
        var path = Path.Combine(_workDir, fileName);
        return File.Exists(path) ? File.ReadAllLines(path) : [];
    }

    // Echoes the headers of interest into the page (one element per header),
    // so a scraper can read back exactly what the server received. A header
    // that wasn't sent shows as "-".
    private static LocalTestServer EchoServer(Action<string>? onHeadRequest = null) => new(request =>
    {
        string H(string name) => request.Headers[name] ?? "-";
        if (request.HttpMethod == "HEAD")
        {
            onHeadRequest?.Invoke($"{H("X-Probe")}|{H("User-Agent")}");
            return new LocalTestServerResponse("", "text/html", Headers: new Dictionary<string, string> { ["ETag"] = "\"v1\"" });
        }
        var html = "<html><body><div class='item'>"
            + $"<span class='lang'>{H("Accept-Language")}</span>"
            + $"<span class='key'>{H("X-Api-Key")}</span>"
            + $"<span class='ua'>{System.Net.WebUtility.HtmlEncode(H("User-Agent"))}</span>"
            + "</div></body></html>";
        return new LocalTestServerResponse(html, "text/html; charset=utf-8");
    });

    private static List<ApiHeader> LangAndKey() =>
    [
        new ApiHeader { Name = "Accept-Language", Value = "de-CH" },
        new ApiHeader { Name = "X-Api-Key", EnvironmentVariableName = "SF_TEST_API_KEY" },
    ];

    private static readonly Dictionary<string, string> KeyEnv = new() { ["SF_TEST_API_KEY"] = "s3cret-key" };

    private static ScrapingPlan FlatPlan(string url, List<ApiHeader>? headers, ScrapingEngine engine = ScrapingEngine.Static, bool persistentSession = false) => new()
    {
        Engine = engine,
        Headers = headers,
        PersistentSession = persistentSession,
        Steps =
        [
            new NavigateStep { Urls = [url] },
            new ExtractStep { Name = "Lang", Selector = ".lang" },
            new ExtractStep { Name = "Key", Selector = ".key" },
            new ExtractStep { Name = "UA", Selector = ".ua" },
        ],
    };

    // ---- static engine --------------------------------------------------

    [Fact]
    public async Task Static_Flat_SendsLiteralAndEnvironmentVariableHeaders()
    {
        using var server = EchoServer();
        var script = new PythonCodeGenerator().Generate(FlatPlan(server.BaseUrl, LangAndKey()));

        var (exit, stderr) = await RunAsync(script, KeyEnv);

        Assert.True(exit == 0, stderr);
        var row = ReadLines("output.csv")[1];
        Assert.StartsWith("de-CH,s3cret-key,", row);
        // the default User-Agent is still there when none was configured
        Assert.Contains("ScrapingFactory/1.0", row);
        // and the secret never appears in the generated script itself
        Assert.DoesNotContain("s3cret-key", script);
    }

    [Fact]
    public async Task Static_Flat_NoHeaders_SendsOnlyTheDefaultUserAgent()
    {
        using var server = EchoServer();

        var (exit, _) = await RunAsync(new PythonCodeGenerator().Generate(FlatPlan(server.BaseUrl, null)));

        Assert.Equal(0, exit);
        Assert.StartsWith("-,-,", ReadLines("output.csv")[1]);
    }

    [Fact]
    public async Task Static_Flat_UserAgentHeader_ReplacesTheDefaultCaseInsensitively()
    {
        using var server = EchoServer();
        var headers = new List<ApiHeader> { new() { Name = "user-agent", Value = "MyBot/9.9" } };

        var (exit, _) = await RunAsync(new PythonCodeGenerator().Generate(FlatPlan(server.BaseUrl, headers)));

        Assert.Equal(0, exit);
        var row = ReadLines("output.csv")[1];
        Assert.EndsWith(",MyBot/9.9", row);
        Assert.DoesNotContain("ScrapingFactory", row);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task MissingEnvironmentVariable_FailsCleanlyNamingTheVariable(bool browserEngine)
    {
        using var server = EchoServer();
        // a variable name nothing sets — the script must stop with the dedicated
        // exit code and a readable message, not a raw KeyError traceback
        var headers = new List<ApiHeader> { new() { Name = "X-Api-Key", EnvironmentVariableName = "SF_TEST_UNSET_HEADER_VAR_226" } };
        var script = browserEngine
            ? new PythonPlaywrightCodeGenerator().Generate(FlatPlan(server.BaseUrl, headers, ScrapingEngine.Browser))
            : new PythonCodeGenerator().Generate(FlatPlan(server.BaseUrl, headers));

        var (exit, stderr) = await RunAsync(script);

        Assert.Equal(78, exit);
        Assert.Contains("ERROR: required environment variable 'SF_TEST_UNSET_HEADER_VAR_226' is not set.", stderr);
        Assert.DoesNotContain("Traceback", stderr);
        Assert.Empty(ReadLines("output.csv"));
    }

    [Fact]
    public async Task Static_Container_SendsHeaders()
    {
        using var server = EchoServer();
        var plan = new ScrapingPlan
        {
            Headers = LangAndKey(),
            OutputFormat = OutputFormat.Xml,
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractGroupStep
                {
                    Roots =
                    [
                        new GroupNode
                        {
                            Name = "Item", Selector = ".item", Repeating = true,
                            Children = [new DataFieldNode { Name = "Lang", Selector = ".lang" }, new DataFieldNode { Name = "Key", Selector = ".key" }],
                        },
                    ],
                },
            ],
        };

        var (exit, stderr) = await RunAsync(new PythonCodeGenerator().Generate(plan), KeyEnv);

        Assert.True(exit == 0, stderr);
        var item = XDocument.Load(Path.Combine(_workDir, "output.xml")).Root!.Element("Item")!;
        Assert.Equal("de-CH", item.Element("Lang")!.Value);
        Assert.Equal("s3cret-key", item.Element("Key")!.Value);
    }

    [Fact]
    public async Task Static_Blocks_SendHeaders()
    {
        using var server = EchoServer();
        var plan = new ScrapingPlan
        {
            Headers = LangAndKey(),
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractionBlockStep
                {
                    Blocks =
                    [
                        new PlanExtractionBlock { Name = "a", OutputFormat = OutputFormat.Csv, OutputFileBaseName = "a", Fields = [new ExtractStep { Name = "Lang", Selector = ".lang" }] },
                        new PlanExtractionBlock { Name = "b", OutputFormat = OutputFormat.Csv, OutputFileBaseName = "b", Fields = [new ExtractStep { Name = "Key", Selector = ".key" }] },
                    ],
                },
            ],
        };

        var (exit, stderr) = await RunAsync(new PythonCodeGenerator().Generate(plan), KeyEnv);

        Assert.True(exit == 0, stderr);
        Assert.Equal(["Lang", "de-CH"], ReadLines("a.csv"));
        Assert.Equal(["Key", "s3cret-key"], ReadLines("b.csv"));
    }

    [Fact]
    public async Task Static_Preflight_SendsTheHeadersOnItsHeadRequest()
    {
        var seen = new List<string>();
        using var server = EchoServer(seen.Add);
        var plan = FlatPlan(server.BaseUrl, [new ApiHeader { Name = "X-Probe", Value = "yes" }]);
        var withPreflight = new ScrapingPlan { Steps = plan.Steps, Headers = plan.Headers, Preflight = true };

        var (exit, stderr) = await RunAsync(new PythonCodeGenerator().Generate(withPreflight));

        Assert.True(exit == 0, stderr);
        Assert.Contains(seen, entry => entry.StartsWith("yes|"));
    }

    // ---- Browser engine ---------------------------------------------------

    [Fact]
    public async Task Browser_Flat_SendsExtraHeaders()
    {
        using var server = EchoServer();
        var script = new PythonPlaywrightCodeGenerator().Generate(FlatPlan(server.BaseUrl, LangAndKey(), ScrapingEngine.Browser));

        var (exit, stderr) = await RunAsync(script, KeyEnv);

        Assert.True(exit == 0, stderr);
        Assert.StartsWith("de-CH,s3cret-key,", ReadLines("output.csv")[1]);
        Assert.DoesNotContain("s3cret-key", script);
    }

    [Fact]
    public async Task Browser_Flat_UserAgentHeader_GoesThroughTheUserAgentOption()
    {
        using var server = EchoServer();
        var headers = new List<ApiHeader> { new() { Name = "User-Agent", Value = "MyBrowserBot/2.0" } };

        var (exit, stderr) = await RunAsync(new PythonPlaywrightCodeGenerator().Generate(FlatPlan(server.BaseUrl, headers, ScrapingEngine.Browser)));

        Assert.True(exit == 0, stderr);
        Assert.EndsWith(",MyBrowserBot/2.0", ReadLines("output.csv")[1]);
    }

    [Fact]
    public async Task Browser_Flat_WithPersistentSession_StillSendsTheHeaders()
    {
        using var server = EchoServer();
        var script = new PythonPlaywrightCodeGenerator().Generate(FlatPlan(server.BaseUrl, LangAndKey(), ScrapingEngine.Browser, persistentSession: true));

        var (exit, stderr) = await RunAsync(script, KeyEnv);

        Assert.True(exit == 0, stderr);
        Assert.StartsWith("de-CH,s3cret-key,", ReadLines("output.csv")[1]);
    }

    [Fact]
    public async Task Browser_Container_SendsHeaders()
    {
        using var server = EchoServer();
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Headers = LangAndKey(),
            OutputFormat = OutputFormat.Xml,
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractGroupStep
                {
                    Roots =
                    [
                        new GroupNode
                        {
                            Name = "Item", Selector = ".item", Repeating = true,
                            Children = [new DataFieldNode { Name = "Lang", Selector = ".lang" }],
                        },
                    ],
                },
            ],
        };

        var (exit, stderr) = await RunAsync(new PythonPlaywrightCodeGenerator().Generate(plan), KeyEnv);

        Assert.True(exit == 0, stderr);
        Assert.Equal("de-CH", XDocument.Load(Path.Combine(_workDir, "output.xml")).Root!.Element("Item")!.Element("Lang")!.Value);
    }

    [Fact]
    public async Task Browser_Blocks_SendHeaders()
    {
        using var server = EchoServer();
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Headers = LangAndKey(),
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractionBlockStep
                {
                    Blocks =
                    [
                        new PlanExtractionBlock { Name = "a", OutputFormat = OutputFormat.Csv, OutputFileBaseName = "a", Fields = [new ExtractStep { Name = "Lang", Selector = ".lang" }] },
                        new PlanExtractionBlock { Name = "b", OutputFormat = OutputFormat.Csv, OutputFileBaseName = "b", Fields = [new ExtractStep { Name = "Key", Selector = ".key" }] },
                    ],
                },
            ],
        };

        var (exit, stderr) = await RunAsync(new PythonPlaywrightCodeGenerator().Generate(plan), KeyEnv);

        Assert.True(exit == 0, stderr);
        Assert.Equal(["Lang", "de-CH"], ReadLines("a.csv"));
        Assert.Equal(["Key", "s3cret-key"], ReadLines("b.csv"));
    }

    [Fact]
    public async Task Browser_Preflight_SendsTheHeadersOnItsHeadRequest()
    {
        var seen = new List<string>();
        using var server = EchoServer(seen.Add);
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Headers = [new ApiHeader { Name = "X-Probe", Value = "yes" }, new ApiHeader { Name = "User-Agent", Value = "ProbeAgent/1" }],
            Preflight = true,
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Lang", Selector = ".lang" }],
        };

        var (exit, stderr) = await RunAsync(new PythonPlaywrightCodeGenerator().Generate(plan));

        Assert.True(exit == 0, stderr);
        Assert.Contains(seen, entry => entry == "yes|ProbeAgent/1");
    }
}
