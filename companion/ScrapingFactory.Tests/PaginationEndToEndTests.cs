using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #174: real end-to-end proof that a generated static-engine script
// actually follows pagination across multiple real requests, for both
// response shapes (flat/Fields, tree/Groups) and both kinds
// (NextLinkPagination/PageNumberPagination) — same "prove the exact
// artifact works" philosophy as ProxyEndToEndTests/ChangeDetectionEndToEndTests.
// Browser-engine (Playwright) coverage lives in
// PythonPlaywrightScriptVerifierTests instead, alongside its own existing
// real-execution tests.
public class PaginationEndToEndTests
{
    private static string GenerateFlatScript(ScrapingPlan plan) => new PythonCodeGenerator().Generate(plan);

    // ── Flat mode ──────────────────────────────────────────────────────

    [Fact]
    public async Task Flat_NextLink_FollowsUntilLinkDisappears_Succeeds()
    {
        using var server = new LocalTestServer(request =>
        {
            var page = request.QueryString["p"] ?? "1";
            var next = page switch
            {
                "1" => """<a class="next" href="?p=2">Next</a>""",
                "2" => """<a class="next" href="?p=3">Next</a>""",
                _ => "",
            };
            var html = $"""<html><body><h1>Item {page}</h1>{next}</body></html>""";
            return new LocalTestServerResponse(html, "text/html");
        });

        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
            Pagination = new NextLinkPagination { NextLinkSelector = "a.next", MaxPages = 10 },
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateFlatScript(plan));

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, result.RowCount); // pages 1, 2, 3 — link disappears after page 3
    }

    [Fact]
    public async Task Flat_PageNumber_FollowsTemplateUntilEmptyPage_Succeeds()
    {
        using var server = new LocalTestServer(request =>
        {
            var page = request.QueryString["page"] is { } raw ? int.Parse(raw) : 1;
            var html = page > 3 ? "<html><body></body></html>" : $"<html><body><h1>Item {page}</h1></body></html>";
            return new LocalTestServerResponse(html, "text/html");
        });

        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
            Pagination = new PageNumberPagination { UrlTemplate = "{url}?page={page}", MaxPages = 10 },
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateFlatScript(plan));

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, result.RowCount);
    }

    [Fact]
    public async Task Flat_PageNumber_StopsAtMaxPagesEvenIfMorePagesWouldExist()
    {
        // The server always returns content — never an empty page — so only
        // the MaxPages safety cap can end the loop.
        using var server = new LocalTestServer(_ =>
            new LocalTestServerResponse("<html><body><h1>Item</h1></body></html>", "text/html"));

        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
            Pagination = new PageNumberPagination { UrlTemplate = "{url}?page={page}", MaxPages = 3 },
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateFlatScript(plan));

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, result.RowCount);
    }

    // Issue #83's own AdditionalUrls composes with pagination (per the
    // feature's own doc comment): each start URL paginates onward
    // independently, using the *same* {url}-relative template each time.
    [Fact]
    public async Task Flat_PageNumber_CombinesWithAdditionalUrls_PaginatesEachIndependently()
    {
        using var serverA = new LocalTestServer(request =>
        {
            var page = request.QueryString["page"] is { } raw ? int.Parse(raw) : 1;
            var html = page > 2 ? "<html><body></body></html>" : $"<html><body><h1>A{page}</h1></body></html>";
            return new LocalTestServerResponse(html, "text/html");
        });
        using var serverB = new LocalTestServer(request =>
        {
            var page = request.QueryString["page"] is { } raw ? int.Parse(raw) : 1;
            var html = page > 3 ? "<html><body></body></html>" : $"<html><body><h1>B{page}</h1></body></html>";
            return new LocalTestServerResponse(html, "text/html");
        });

        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [serverA.BaseUrl, serverB.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
            Pagination = new PageNumberPagination { UrlTemplate = "{url}?page={page}", MaxPages = 10 },
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateFlatScript(plan));

        Assert.True(result.Success, result.Error);
        Assert.Equal(5, result.RowCount); // 2 from serverA + 3 from serverB
    }

    // A page with no "next" link at all (the common single-page-result case)
    // must not be treated as an error — pagination simply never advances
    // past page 1.
    [Fact]
    public async Task Flat_NextLink_NoLinkOnFirstPage_SucceedsWithJustThatPage()
    {
        using var server = new LocalTestServer("<html><body><h1>Only page</h1></body></html>");

        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
            Pagination = new NextLinkPagination { NextLinkSelector = "a.next", MaxPages = 10 },
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateFlatScript(plan));

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, result.RowCount);
    }

    // ── Container mode (OutputFormat.Xml) ────────────────────────────────

    private static string GenerateGroupedScript(ScrapingPlan plan) => new PythonCodeGenerator().Generate(plan);

    private static GroupNode ItemGroup() => new()
    {
        Name = "Item", Selector = "li.item", Repeating = true,
        Children = [new DataFieldNode { Name = "Titel", Selector = "span" }],
    };

    [Fact]
    public async Task Grouped_NextLink_FollowsUntilLinkDisappears_Succeeds()
    {
        using var server = new LocalTestServer(request =>
        {
            var page = request.QueryString["p"] ?? "1";
            var next = page == "1" ? """<a class="next" href="?p=2">Next</a>""" : "";
            var html = $"""<html><body><ul><li class="item"><span>Item {page}</span></li></ul>{next}</body></html>""";
            return new LocalTestServerResponse(html, "text/html");
        });

        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractGroupStep { Roots = [ItemGroup()] }],
            OutputFormat = OutputFormat.Xml,
            Pagination = new NextLinkPagination { NextLinkSelector = "a.next", MaxPages = 10 },
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateGroupedScript(plan), OutputFormat.Xml);

        Assert.True(result.Success, result.Error);
        // 2 pages x (1 <Item> + 1 <Titel>) = 4
        Assert.Equal(4, result.RowCount);
    }

    [Fact]
    public async Task Grouped_PageNumber_FollowsTemplateUntilEmptyPage_Succeeds()
    {
        using var server = new LocalTestServer(request =>
        {
            var page = request.QueryString["page"] is { } raw ? int.Parse(raw) : 1;
            var html = page > 2
                ? "<html><body><ul></ul></body></html>"
                : $"""<html><body><ul><li class="item"><span>Item {page}</span></li></ul></body></html>""";
            return new LocalTestServerResponse(html, "text/html");
        });

        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractGroupStep { Roots = [ItemGroup()] }],
            OutputFormat = OutputFormat.Xml,
            Pagination = new PageNumberPagination { UrlTemplate = "{url}?page={page}", MaxPages = 10 },
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateGroupedScript(plan), OutputFormat.Xml);

        Assert.True(result.Success, result.Error);
        // 2 pages x (1 <Item> + 1 <Titel>) = 4
        Assert.Equal(4, result.RowCount);
    }
}
