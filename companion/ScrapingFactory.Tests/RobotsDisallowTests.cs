using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #333: the generated script checks every request against the target's
// robots.txt Disallow/Allow rules at run time — rendered shape, and real runs
// against a LocalTestServer that records which paths were actually requested
// (static and Browser engine, API mode, Warn/Skip/Abort).
public class RobotsDisallowTests
{
    private const string Page = "<html><body><h1>Seite</h1><a class='next' href='/private/page2'>next</a></body></html>";

    private static ScrapingPlan FlatPlan(string url, RobotsDisallowAction? action, ScrapingEngine engine = ScrapingEngine.Static,
        List<string>? additionalUrls = null, PaginationConfig? pagination = null, bool respectDelay = false) => new()
    {
        Steps = [new NavigateStep { Urls = [url, .. additionalUrls ?? []] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
        Engine = engine,
        RobotsDisallow = action is null ? null : new RobotsDisallowConfig { Action = action.Value },
        Pagination = pagination,
        RespectRobotsDelay = respectDelay,
    };

    private static string Generate(ScrapingPlan plan) => plan.Engine == ScrapingEngine.Browser
        ? new PythonPlaywrightCodeGenerator().Generate(plan)
        : new PythonCodeGenerator().Generate(plan);

    // ── Rendered script ──────────────────────────────────────────────────────

    [Fact]
    public void GeneratedScript_WithoutTheOption_HasNoRobotsHandling()
    {
        var script = Generate(FlatPlan("https://example.com", null));
        Assert.DoesNotContain("robots", script, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(RobotsDisallowAction.Warn, "Warn")]
    [InlineData(RobotsDisallowAction.Skip, "Skip")]
    [InlineData(RobotsDisallowAction.Abort, "Abort")]
    public void GeneratedScript_RendersTheChosenAction(RobotsDisallowAction action, string literal)
    {
        var script = Generate(FlatPlan("https://example.com", action));
        Assert.Contains($"ROBOTS_ACTION = '{literal}'", script);
        Assert.Contains("EXIT_ROBOTS_DISALLOWED = 9", script);
    }

    [Fact]
    public void WireFormat_DefaultsToSkip()
    {
        var config = System.Text.Json.JsonSerializer.Deserialize<ScrapingConfig>(
            """{"url":"https://example.com","fields":[{"name":"T","selector":"h1"}],"robotsDisallow":{}}""",
            new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web) { Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() } });
        Assert.Equal(RobotsDisallowAction.Skip, config!.RobotsDisallow!.Action);
    }

    // ── Real runs ────────────────────────────────────────────────────────────

    private sealed class RobotsServer : IDisposable
    {
        private readonly ConcurrentQueue<string> _requests = new();
        public LocalTestServer Server { get; }

        // robotsStatus 404 + null text = no robots.txt at all.
        public RobotsServer(string? robotsTxt, HttpStatusCode robotsStatus = HttpStatusCode.OK, Func<string, LocalTestServerResponse?>? extra = null)
        {
            Server = new LocalTestServer(request =>
            {
                var path = request.Url!.AbsolutePath;
                _requests.Enqueue(path);
                if (path == "/robots.txt")
                    return new LocalTestServerResponse(robotsTxt ?? "not found", "text/plain; charset=utf-8", robotsTxt is null && robotsStatus == HttpStatusCode.OK ? HttpStatusCode.NotFound : robotsStatus);
                return extra?.Invoke(path) ?? new LocalTestServerResponse(Page, "text/html; charset=utf-8");
            });
        }

        public string Url(string path = "") => Server.BaseUrl.TrimEnd('/') + "/" + path.TrimStart('/');
        public bool WasRequested(string path) => _requests.Contains(path);
        public int Count(string path) => _requests.Count(p => p == path);
        public void Dispose() => Server.Dispose();
    }

    private static async Task<(int ExitCode, string Stdout, string Stderr)> RunAsync(string script)
    {
        var dir = Directory.CreateTempSubdirectory("sf-robots-").FullName;
        try
        {
            var path = Path.Combine(dir, "scraper.py");
            await File.WriteAllTextAsync(path, script);
            foreach (var candidate in new[] { "python3", "python" })
            {
                var psi = new ProcessStartInfo(candidate) { WorkingDirectory = dir, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
                psi.ArgumentList.Add(path);
                try
                {
                    using var process = Process.Start(psi)!;
                    var stdout = process.StandardOutput.ReadToEndAsync();
                    var stderr = process.StandardError.ReadToEndAsync();
                    await process.WaitForExitAsync(new CancellationTokenSource(TimeSpan.FromSeconds(90)).Token);
                    return (process.ExitCode, await stdout, await stderr);
                }
                catch (System.ComponentModel.Win32Exception) { }
            }
            throw new InvalidOperationException("No Python interpreter found.");
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    private static Task<ScriptVerificationResult> Verify(ScrapingPlan plan) =>
        new PythonScriptVerifier().VerifyAsync(Generate(plan), extraTimeout: TimeSpan.FromSeconds(60));

    private const string PrivateRules = "User-agent: *\nDisallow: /private/\n";

    [Fact]
    public async Task Skip_DoesNotRequestADisallowedStartUrl_ButCarriesOn()
    {
        using var robots = new RobotsServer(PrivateRules);
        var plan = FlatPlan(robots.Url("ok"), RobotsDisallowAction.Skip, additionalUrls: [robots.Url("private/x")]);

        var (exit, stdout, stderr) = await RunAsync(Generate(plan));

        Assert.True(exit == 0, stderr);
        Assert.True(robots.WasRequested("/ok"));
        Assert.False(robots.WasRequested("/private/x"));
        Assert.Contains("Skipped (disallowed by robots.txt)", stdout);
    }

    [Fact]
    public async Task Warn_WarnsButStillRequests()
    {
        using var robots = new RobotsServer(PrivateRules);
        var plan = FlatPlan(robots.Url("private/x"), RobotsDisallowAction.Warn);

        var (exit, _, stderr) = await RunAsync(Generate(plan));

        Assert.True(exit == 0, stderr);
        Assert.True(robots.WasRequested("/private/x"));
        Assert.Contains("robots.txt disallows", stderr);
        // Reported once per URL, even though start URL and the page loop both check it.
        Assert.Equal(1, System.Text.RegularExpressions.Regex.Count(stderr, "robots.txt disallows"));
    }

    [Fact]
    public async Task Abort_StopsWithADedicatedExitCode_AndACleanMessage()
    {
        using var robots = new RobotsServer(PrivateRules);
        var plan = FlatPlan(robots.Url("private/x"), RobotsDisallowAction.Abort);

        var (exit, _, stderr) = await RunAsync(Generate(plan));

        Assert.Equal(9, exit);
        Assert.Contains("robots.txt disallows", stderr);
        Assert.DoesNotContain("Traceback", stderr);
        Assert.False(robots.WasRequested("/private/x"));

        var verified = await Verify(plan);
        Assert.False(verified.Success);
        Assert.Contains("robots.txt disallows", verified.Error);
        Assert.DoesNotContain("Traceback", verified.Error);
    }

    [Fact]
    public async Task AllowedPaths_AreRequestedNormally_AndRobotsTxtIsReadOnce()
    {
        using var robots = new RobotsServer(PrivateRules);
        var plan = FlatPlan(robots.Url("ok"), RobotsDisallowAction.Abort, additionalUrls: [robots.Url("also-ok")]);

        var result = await Verify(plan);

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, robots.Count("/robots.txt"));
    }

    // RFC 9309: the longest matching pattern wins, a tie goes to Allow,
    // `*` is a wildcard and a trailing `$` anchors the end.
    [Theory]
    [InlineData("User-agent: *\nDisallow: /private/\nAllow: /private/public.html\n", "/private/public.html", true)]
    [InlineData("User-agent: *\nDisallow: /private/\nAllow: /private/public.html\n", "/private/secret.html", false)]
    [InlineData("User-agent: *\nDisallow: /a\nAllow: /a\n", "/a", true)]
    [InlineData("User-agent: *\nDisallow: /*.pdf$\n", "/files/report.pdf", false)]
    [InlineData("User-agent: *\nDisallow: /*.pdf$\n", "/files/report.pdf.html", true)]
    [InlineData("User-agent: *\nDisallow: /search?\n", "/search", true)]
    [InlineData("User-agent: *\nDisallow:\n", "/anything", true)]
    [InlineData("User-agent: *\nDisallow: /\n", "/anything", false)]
    [InlineData("User-agent: *\nDisallow: /\n\nUser-agent: ScrapingFactory\nDisallow: /nope/\n", "/anything", true)]
    [InlineData("User-agent: *\nDisallow: /\n\nUser-agent: ScrapingFactory\nDisallow: /nope/\n", "/nope/x", false)]
    [InlineData("User-agent: otherbot\nDisallow: /\n", "/anything", true)]
    [InlineData("# a comment\nUser-agent: *   # everyone\nDisallow: /x # not this\n", "/x/y", false)]
    [InlineData("User-agent: scrapingfactory\nUser-agent: other\nDisallow: /shared/\n", "/shared/z", false)]
    public async Task RulesAreEvaluatedLikeRfc9309(string robotsTxt, string path, bool expectedAllowed)
    {
        using var robots = new RobotsServer(robotsTxt);
        var plan = FlatPlan(robots.Url(path.TrimStart('/')), RobotsDisallowAction.Skip);

        var (exit, _, stderr) = await RunAsync(Generate(plan));

        Assert.True(exit == 0, stderr);
        Assert.Equal(expectedAllowed, robots.WasRequested(path));
    }

    [Fact]
    public async Task RobotsTxtItselfIsNeverBlocked()
    {
        using var robots = new RobotsServer("User-agent: *\nDisallow: /\n");
        var plan = FlatPlan(robots.Url("page"), RobotsDisallowAction.Skip);

        var (exit, stdout, _) = await RunAsync(Generate(plan));

        Assert.Equal(0, exit);
        Assert.False(robots.WasRequested("/page"));
        Assert.Contains("Skipped", stdout);
    }

    [Fact]
    public async Task MissingRobotsTxt_MeansNoRestrictions()
    {
        using var robots = new RobotsServer(null);
        var result = await Verify(FlatPlan(robots.Url("private/x"), RobotsDisallowAction.Abort));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public async Task UnreadableRobotsTxt_WarnsAndDoesNotBlock()
    {
        using var robots = new RobotsServer("oops", HttpStatusCode.ServiceUnavailable);
        var plan = FlatPlan(robots.Url("private/x"), RobotsDisallowAction.Abort);

        var (exit, _, stderr) = await RunAsync(Generate(plan));

        Assert.True(exit == 0, stderr);
        Assert.Contains("could not read", stderr);
        Assert.Contains("HTTP 503", stderr);
        Assert.True(robots.WasRequested("/private/x"));
    }

    [Fact]
    public async Task Static_DisallowedPaginationPage_EndsTheChain()
    {
        using var robots = new RobotsServer("User-agent: *\nDisallow: /list2\n");
        var pagination = new PageNumberPagination { UrlTemplate = robots.Url("list{page}"), MaxPages = 5 };
        var plan = FlatPlan(robots.Url("list1"), RobotsDisallowAction.Skip, pagination: pagination);

        var (exit, _, stderr) = await RunAsync(Generate(plan));

        Assert.True(exit == 0, stderr);
        Assert.True(robots.WasRequested("/list1"));
        Assert.False(robots.WasRequested("/list2"));
        Assert.False(robots.WasRequested("/list3"));
    }

    [Fact]
    public async Task Browser_Skip_DoesNotNavigateToADisallowedStartUrl()
    {
        using var robots = new RobotsServer(PrivateRules);
        var plan = FlatPlan(robots.Url("ok"), RobotsDisallowAction.Skip, ScrapingEngine.Browser, additionalUrls: [robots.Url("private/x")]);

        var (exit, stdout, stderr) = await RunAsync(Generate(plan));

        Assert.True(exit == 0, stderr);
        Assert.True(robots.WasRequested("/ok"));
        Assert.False(robots.WasRequested("/private/x"));
        Assert.Contains("Skipped (disallowed by robots.txt)", stdout);
    }

    [Fact]
    public async Task Browser_DisallowedNextLink_EndsThePagination()
    {
        using var robots = new RobotsServer(PrivateRules);
        var pagination = new NextLinkPagination { NextLinkSelector = "a.next", MaxPages = 5 };
        var plan = FlatPlan(robots.Url("ok"), RobotsDisallowAction.Skip, ScrapingEngine.Browser, pagination: pagination);

        var (exit, _, stderr) = await RunAsync(Generate(plan));

        Assert.True(exit == 0, stderr);
        Assert.False(robots.WasRequested("/private/page2"));
    }

    [Fact]
    public async Task Browser_Abort_ExitsWithTheDedicatedCode()
    {
        using var robots = new RobotsServer(PrivateRules);
        var (exit, _, stderr) = await RunAsync(Generate(FlatPlan(robots.Url("private/x"), RobotsDisallowAction.Abort, ScrapingEngine.Browser)));

        Assert.Equal(9, exit);
        Assert.Contains("robots.txt disallows", stderr);
    }

    [Fact]
    public async Task Container_Skip_DoesNotRequestADisallowedStartUrl()
    {
        using var robots = new RobotsServer(PrivateRules);
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [robots.Url("ok"), robots.Url("private/x")] },
                new ExtractGroupStep
                {
                    Roots = [new GroupNode { Name = "G", Selector = "body", Repeating = true, Children = [new DataFieldNode { Name = "T", Selector = "h1", Mode = ExtractMode.Text }] }],
                },
            ],
            OutputFormat = OutputFormat.Xml,
            RobotsDisallow = new RobotsDisallowConfig { Action = RobotsDisallowAction.Skip },
        };

        var (exit, _, stderr) = await RunAsync(Generate(plan));

        Assert.True(exit == 0, stderr);
        Assert.True(robots.WasRequested("/ok"));
        Assert.False(robots.WasRequested("/private/x"));
    }

    [Theory]
    [InlineData(ScrapingEngine.Static)]
    [InlineData(ScrapingEngine.Browser)]
    public async Task Blocks_Skip_DoesNotRequestADisallowedStartUrl(ScrapingEngine engine)
    {
        using var robots = new RobotsServer(PrivateRules);
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [robots.Url("ok"), robots.Url("private/x")] },
                new ExtractionBlockStep
                {
                    Blocks =
                    [
                        new PlanExtractionBlock { Name = "a", OutputFormat = OutputFormat.Csv, OutputFileBaseName = "a", Fields = [new ExtractStep { Name = "T", Selector = "h1" }] },
                        new PlanExtractionBlock { Name = "b", OutputFormat = OutputFormat.Csv, OutputFileBaseName = "b", Fields = [new ExtractStep { Name = "T", Selector = "h1" }] },
                    ],
                },
            ],
            Engine = engine,
            RobotsDisallow = new RobotsDisallowConfig { Action = RobotsDisallowAction.Skip },
        };

        var (exit, _, stderr) = await RunAsync(Generate(plan));

        Assert.True(exit == 0, stderr);
        Assert.True(robots.WasRequested("/ok"));
        Assert.False(robots.WasRequested("/private/x"));
    }

    [Fact]
    public async Task SharesTheOneRobotsFetchWithCrawlDelay()
    {
        using var robots = new RobotsServer("User-agent: *\nCrawl-delay: 0\nDisallow: /private/\n");
        var plan = FlatPlan(robots.Url("ok"), RobotsDisallowAction.Skip, additionalUrls: [robots.Url("ok2")], respectDelay: true);

        var (exit, _, stderr) = await RunAsync(Generate(plan));

        Assert.True(exit == 0, stderr);
        Assert.Equal(1, robots.Count("/robots.txt"));
    }

    [Fact]
    public async Task Downloads_OfADisallowedResource_AreSkipped()
    {
        using var robots = new RobotsServer(PrivateRules, extra: path => path == "/list"
            ? new LocalTestServerResponse("<html><body><img class='i' src='/private/pic.png'><img class='i' src='/pub/pic.png'></body></html>", "text/html")
            : new LocalTestServerResponse("PNG", "image/png"));
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [robots.Url("list")] }, new ExtractStep { Name = "Bild", Selector = "img.i", Attribute = "src", Download = true }],
            RobotsDisallow = new RobotsDisallowConfig { Action = RobotsDisallowAction.Skip },
        };

        var (exit, _, stderr) = await RunAsync(Generate(plan));

        Assert.True(exit == 0, stderr);
        Assert.False(robots.WasRequested("/private/pic.png"));
        Assert.True(robots.WasRequested("/pub/pic.png"));
    }

    // ── API mode ─────────────────────────────────────────────────────────────

    private static ScrapingPlan ApiPlan(string urlTemplate, RobotsDisallowAction action, List<ApiParameter>? parameters = null) => new()
    {
        Steps =
        [
            new NavigateStep { Urls = ["https://example.com"] },
            new ApiCallStep
            {
                Config = new ApiConfig
                {
                    UrlTemplate = urlTemplate, ItemsPath = "items",
                    Fields = [new ApiField { Name = "Title", Path = "title" }],
                    Parameters = parameters ?? [],
                },
            },
        ],
        OutputFormat = OutputFormat.Csv,
        Engine = ScrapingEngine.Api,
        RobotsDisallow = new RobotsDisallowConfig { Action = action },
    };

    private static LocalTestServerResponse Json(string path) => new(
        """{ "items": [ { "title": "t" } ], "values": ["a", "b"] }""", "application/json");

    [Fact]
    public async Task Api_Skip_DoesNotRequestADisallowedCombination()
    {
        using var robots = new RobotsServer("User-agent: *\nDisallow: /api/b\n", extra: Json);
        var plan = ApiPlan(robots.Url("api/{x}"), RobotsDisallowAction.Skip,
            [new ApiParameter { Name = "x", Source = new StaticListSource { Values = ["a", "b"] } }]);

        var (exit, stdout, stderr) = await RunAsync(new PythonApiCodeGenerator().Generate(plan));

        Assert.True(exit == 0, stderr);
        Assert.True(robots.WasRequested("/api/a"));
        Assert.False(robots.WasRequested("/api/b"));
        Assert.Contains("Skipped (disallowed by robots.txt)", stdout);
    }

    [Fact]
    public async Task Api_Abort_ExitsWithTheDedicatedCode()
    {
        using var robots = new RobotsServer("User-agent: *\nDisallow: /api/\n", extra: Json);
        var plan = ApiPlan(robots.Url("api/items"), RobotsDisallowAction.Abort);

        var (exit, _, stderr) = await RunAsync(new PythonApiCodeGenerator().Generate(plan));

        Assert.Equal(9, exit);
        Assert.Contains("robots.txt disallows", stderr);
    }

    [Fact]
    public async Task Api_DisallowedDiscoveryRequest_YieldsNoValues()
    {
        using var robots = new RobotsServer("User-agent: *\nDisallow: /discover\n", extra: Json);
        var plan = ApiPlan(robots.Url("api/{x}"), RobotsDisallowAction.Skip,
            [new ApiParameter { Name = "x", Source = new DiscoverySource { UrlTemplate = robots.Url("discover"), ItemsPath = "values", ValuePath = "" } }]);

        var (exit, stdout, _) = await RunAsync(new PythonApiCodeGenerator().Generate(plan));

        Assert.False(robots.WasRequested("/discover"));
        Assert.Contains("Skipped (disallowed by robots.txt)", stdout);
        Assert.False(robots.WasRequested("/api/a"));
        _ = exit;
    }
}
