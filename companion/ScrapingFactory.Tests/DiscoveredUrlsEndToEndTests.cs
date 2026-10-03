using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #218: real end-to-end proof that a generated script actually fetches
// a navigation/listing page, harvests additional start URLs from it, and
// combines them (additively, deduped) with the statically-typed URLS —
// same "prove the exact artifact works" philosophy as PaginationEndToEndTests,
// which this file mirrors closely since both features touch the same four
// non-API templates. Covers both response shapes (flat/Fields, tree/Groups)
// for the Static engine, plus one Browser-engine (Playwright) test — unlike
// Pagination, this feature adds brand new `requests`/`bs4` imports to the
// two Playwright templates (which never had them before), so that specific
// path is new ground worth its own real-execution proof rather than trusting
// Scriban rendering alone.
public class DiscoveredUrlsEndToEndTests
{
    private static string GenerateFlatScript(ScrapingPlan plan) => new PythonCodeGenerator().Generate(plan);

    // /nav links to two *additional* categories (b, c) — deliberately not
    // back to "a", the primary URL, so the additive-not-duplicating case is
    // covered by a separate test below instead of conflated with this one.
    private static LocalTestServerResponse NavResponder(System.Net.HttpListenerRequest request)
    {
        var path = request.Url!.AbsolutePath;
        if (path == "/nav")
            return new LocalTestServerResponse(
                """<html><body><nav class="categories"><a href="/category/b">B</a><a href="/category/c">C</a></nav></body></html>""",
                "text/html");
        var category = path.Split('/', StringSplitOptions.RemoveEmptyEntries)[^1];
        var title = category switch { "a" => "Alpha", "b" => "Beta", "c" => "Gamma", _ => "Unknown" };
        return new LocalTestServerResponse($"<html><body><h1>{title}</h1></body></html>", "text/html");
    }

    [Fact]
    public async Task Flat_DiscoveredUrls_CombinedAdditivelyWithPrimaryUrl_Succeeds()
    {
        using var server = new LocalTestServer(NavResponder);

        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [$"{server.BaseUrl}category/a"] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
            DiscoveredUrls = new DiscoveredUrlsConfig { PageUrl = $"{server.BaseUrl}nav", LinkSelector = "nav.categories a" },
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateFlatScript(plan), includeOutputFile: true);

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, result.RowCount); // Alpha (primary) + Beta + Gamma (discovered)
        Assert.Contains("Alpha", result.OutputFileContent);
        Assert.Contains("Beta", result.OutputFileContent);
        Assert.Contains("Gamma", result.OutputFileContent);
    }

    // A discovered URL that's already in URLS (e.g. the nav page links back
    // to the primary page itself, a common real-world nav structure) must
    // not be scraped twice.
    [Fact]
    public async Task Flat_DiscoveredUrlAlreadyInUrls_IsNotScrapedTwice()
    {
        using var server = new LocalTestServer(request =>
        {
            var path = request.Url!.AbsolutePath;
            if (path == "/nav")
                return new LocalTestServerResponse(
                    """<html><body><nav class="categories"><a href="/category/a">A</a><a href="/category/b">B</a></nav></body></html>""",
                    "text/html");
            var category = path.Split('/', StringSplitOptions.RemoveEmptyEntries)[^1];
            var title = category == "a" ? "Alpha" : "Beta";
            return new LocalTestServerResponse($"<html><body><h1>{title}</h1></body></html>", "text/html");
        });

        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [$"{server.BaseUrl}category/a"] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
            DiscoveredUrls = new DiscoveredUrlsConfig { PageUrl = $"{server.BaseUrl}nav", LinkSelector = "nav.categories a" },
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateFlatScript(plan));

        Assert.True(result.Success, result.Error);
        Assert.Equal(2, result.RowCount); // Alpha once, Beta once — not Alpha twice
    }

    // A misconfigured/unreachable PageUrl degrades to a warning, not a crash
    // — the main run still proceeds with whatever URLS it already has.
    [Fact]
    public async Task Flat_DiscoveredUrlsPageFetchFails_StillSucceedsWithJustThePrimaryUrl()
    {
        using var server = new LocalTestServer(request =>
            request.Url!.AbsolutePath == "/nav"
                ? new LocalTestServerResponse("Internal Server Error", "text/plain", System.Net.HttpStatusCode.InternalServerError)
                : new LocalTestServerResponse("<html><body><h1>Alpha</h1></body></html>", "text/html"));

        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
            DiscoveredUrls = new DiscoveredUrlsConfig { PageUrl = $"{server.BaseUrl}does-not-exist", LinkSelector = "a" },
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateFlatScript(plan));

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, result.RowCount);
    }

    [Fact]
    public async Task Flat_DiscoveredUrls_StopsAtMaxUrlsEvenIfMoreLinksExist()
    {
        using var server = new LocalTestServer(request =>
        {
            var path = request.Url!.AbsolutePath;
            if (path == "/nav")
            {
                var links = string.Join("", Enumerable.Range(1, 10).Select(i => $"""<a href="/category/{i}">{i}</a>"""));
                return new LocalTestServerResponse($"""<html><body><nav class="categories">{links}</nav></body></html>""", "text/html");
            }
            return new LocalTestServerResponse("<html><body><h1>Item</h1></body></html>", "text/html");
        });

        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [$"{server.BaseUrl}category/0"] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
            DiscoveredUrls = new DiscoveredUrlsConfig { PageUrl = $"{server.BaseUrl}nav", LinkSelector = "nav.categories a", MaxUrls = 3 },
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateFlatScript(plan));

        Assert.True(result.Success, result.Error);
        Assert.Equal(4, result.RowCount); // primary (category/0) + 3 capped discoveries
    }

    // ── Container mode (OutputFormat.Xml) ────────────────────────────────

    private static GroupNode ItemGroup() => new()
    {
        Name = "Item", Selector = "li.item", Repeating = true,
        Children = [new DataFieldNode { Name = "Titel", Selector = "span" }],
    };

    [Fact]
    public async Task Grouped_DiscoveredUrls_CombinedAdditivelyWithPrimaryUrl_Succeeds()
    {
        using var server = new LocalTestServer(request =>
        {
            var path = request.Url!.AbsolutePath;
            if (path == "/nav")
                return new LocalTestServerResponse(
                    """<html><body><nav class="categories"><a href="/category/b">B</a></nav></body></html>""",
                    "text/html");
            var category = path.Split('/', StringSplitOptions.RemoveEmptyEntries)[^1];
            return new LocalTestServerResponse(
                $"""<html><body><ul><li class="item"><span>Item {category}</span></li></ul></body></html>""",
                "text/html");
        });

        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [$"{server.BaseUrl}category/a"] }, new ExtractGroupStep { Roots = [ItemGroup()] }],
            OutputFormat = OutputFormat.Xml,
            DiscoveredUrls = new DiscoveredUrlsConfig { PageUrl = $"{server.BaseUrl}nav", LinkSelector = "nav.categories a" },
        };

        var result = await new PythonScriptVerifier().VerifyAsync(new PythonCodeGenerator().Generate(plan), OutputFormat.Xml);

        Assert.True(result.Success, result.Error);
        // 2 pages (primary "a" + discovered "b") x (1 <Item> + 1 <Titel>) = 4
        Assert.Equal(4, result.RowCount);
    }

    // ── Browser engine (Playwright) ──────────────────────────────────────
    // Proves the discovery pass's own freshly-added `requests`/`bs4` imports
    // actually work inside a Browser-engine script, not just that Scriban
    // renders them — unlike Pagination, these two imports never existed in
    // the Playwright templates before this feature.

    [Fact]
    public async Task Playwright_DiscoveredUrls_CombinedAdditivelyWithPrimaryUrl_Succeeds()
    {
        using var server = new LocalTestServer(NavResponder);

        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [$"{server.BaseUrl}category/a"] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
            Engine = ScrapingEngine.Browser,
            DiscoveredUrls = new DiscoveredUrlsConfig { PageUrl = $"{server.BaseUrl}nav", LinkSelector = "nav.categories a" },
        };

        var result = await new PythonScriptVerifier().VerifyAsync(
            new PythonPlaywrightCodeGenerator().Generate(plan), includeOutputFile: true);

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, result.RowCount);
        Assert.Contains("Alpha", result.OutputFileContent);
        Assert.Contains("Beta", result.OutputFileContent);
        Assert.Contains("Gamma", result.OutputFileContent);
    }
}
