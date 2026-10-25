using System.Net;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using Microsoft.AspNetCore.Mvc.Testing;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #227: real end-to-end proof that a selector ending in :contains("text")
// picks the element by its text — static engine (soupsieve + the bs4 patch) and
// Browser engine (Playwright patch: query_selector filtering, locator().filter) —
// including the tolerant matching rule (case, repeated whitespace, text spread
// over child elements). A black-box "did /generate succeed" check couldn't
// tell a filtered match from an unfiltered one; the scraped values do.
public class TextSelectorEndToEndTests : IDisposable
{
    private readonly string _workDir = Directory.CreateTempSubdirectory("scrapingfactory-text-selector-test-").FullName;

    public void Dispose() => Directory.Delete(_workDir, recursive: true);

    private async Task<(int Exit, string Stderr)> RunAsync(string script)
    {
        var scriptPath = Path.Combine(_workDir, "scraper.py");
        await File.WriteAllTextAsync(scriptPath, script);
        var result = await ScriptRunner.RunAsync(scriptPath, _workDir, timeout: TimeSpan.FromSeconds(90));
        return (result.ExitCode, result.Stderr);
    }

    private string[] ReadLines(string fileName)
    {
        var path = Path.Combine(_workDir, fileName);
        return File.Exists(path) ? File.ReadAllLines(path) : [];
    }

    // Three buttons only told apart by their label — one with a doubled space,
    // one whose label is spread over a child element — plus two same-class
    // "next" links, one of which leads to a second page.
    private const string ButtonsPage = """
        <html><body>
          <div class="card">
            <a class="btn" href="/cart">In den  Warenkorb</a>
            <a class="btn" href="/wish"><span>Mer</span>ken</a>
            <a class="btn" href="/compare">Vergleichen</a>
            <a class="quote" href="/quote">He said "hi" to me</a>
          </div>
          <a class="nav" href="/prev">Zurück</a>
          <a class="nav" href="/page2">Weiter</a>
        </body></html>
        """;

    private static LocalTestServer Server() => new(request => request.Url!.AbsolutePath switch
    {
        "/page2" => new LocalTestServerResponse("<html><body><a class='btn' href='/page2-btn'>Seite zwei</a></body></html>", "text/html; charset=utf-8"),
        "/nav" => new LocalTestServerResponse("<html><body><a class='cat' href='/c1'>Obst</a><a class='cat' href='/c2'>Gemüse</a></body></html>", "text/html; charset=utf-8"),
        "/c1" => new LocalTestServerResponse("<html><body><h1>Obst-Seite</h1></body></html>", "text/html; charset=utf-8"),
        "/c2" => new LocalTestServerResponse("<html><body><h1>Gemüse-Seite</h1></body></html>", "text/html; charset=utf-8"),
        _ => new LocalTestServerResponse(ButtonsPage, "text/html; charset=utf-8"),
    });

    private static ScrapingPlan FlatHref(string url, string selector, ScrapingEngine engine = ScrapingEngine.Static) => new()
    {
        Engine = engine,
        Steps = [new NavigateStep { Urls = [url] }, new ExtractStep { Name = "Link", Selector = selector, Attribute = "href" }],
    };

    private static string Generate(ScrapingPlan plan) => plan.Engine == ScrapingEngine.Browser
        ? new PythonPlaywrightCodeGenerator().Generate(plan)
        : new PythonCodeGenerator().Generate(plan);

    // ---- static engine --------------------------------------------------

    [Theory]
    [InlineData(".btn:contains(\"merken\")", "/wish")]            // case-insensitive, text across a child element
    [InlineData(".btn:contains('in den warenkorb')", "/cart")]    // repeated whitespace in the page
    [InlineData(".btn:contains(\"Vergleich\")", "/compare")]      // substring
    [InlineData(".card .btn:contains(\"Merken\")", "/wish")]      // descendant combinator before the filter
    [InlineData(".quote:contains(\"said \\\"hi\\\"\")", "/quote")] // escaped quotes in the wanted text
    public async Task Static_Flat_PicksTheElementByItsText(string selector, string expectedHref)
    {
        using var server = Server();

        var (exit, stderr) = await RunAsync(Generate(FlatHref(server.BaseUrl, selector)));

        Assert.True(exit == 0, stderr);
        Assert.Equal(["Link", expectedHref], ReadLines("output.csv"));
    }

    [Fact]
    public async Task Static_Flat_NoElementMatchesTheText_YieldsNoRows()
    {
        using var server = Server();

        var (exit, _) = await RunAsync(Generate(FlatHref(server.BaseUrl, ".btn:contains(\"Gibt es nicht\")")));

        Assert.Equal(0, exit);
        Assert.Equal(["Link"], ReadLines("output.csv")); // header only
    }

    [Fact]
    public async Task Static_Container_GroupAndFieldFilteredByText()
    {
        using var server = Server();
        var plan = new ScrapingPlan
        {
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
                            Name = "Karte", Selector = ".card:contains(\"Vergleichen\")", Repeating = true,
                            Children =
                            [
                                new DataFieldNode { Name = "Wunschliste", Selector = "a:contains(\"merken\")", Mode = ExtractMode.Attribute, Attribute = "href" },
                            ],
                        },
                    ],
                },
            ],
        };

        var (exit, stderr) = await RunAsync(Generate(plan));

        Assert.True(exit == 0, stderr);
        Assert.Equal("/wish", XDocument.Load(Path.Combine(_workDir, "output.xml")).Root!.Element("Karte")!.Element("Wunschliste")!.Value);
    }

    [Fact]
    public async Task Static_Blocks_FilterByText()
    {
        using var server = Server();
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractionBlockStep
                {
                    Blocks =
                    [
                        new PlanExtractionBlock { Name = "a", OutputFormat = OutputFormat.Csv, OutputFileBaseName = "a", Fields = [new ExtractStep { Name = "Link", Selector = ".btn:contains(\"merken\")", Attribute = "href" }] },
                        new PlanExtractionBlock { Name = "b", OutputFormat = OutputFormat.Csv, OutputFileBaseName = "b", Fields = [new ExtractStep { Name = "Link", Selector = ".btn:contains(\"warenkorb\")", Attribute = "href" }] },
                    ],
                },
            ],
        };

        var (exit, stderr) = await RunAsync(Generate(plan));

        Assert.True(exit == 0, stderr);
        Assert.Equal(["Link", "/wish"], ReadLines("a.csv"));
        Assert.Equal(["Link", "/cart"], ReadLines("b.csv"));
    }

    [Fact]
    public async Task Static_Pagination_NextLinkPickedByText()
    {
        using var server = Server();
        var plan = new ScrapingPlan
        {
            Pagination = new NextLinkPagination { NextLinkSelector = ".nav:contains(\"Weiter\")", MaxPages = 3 },
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Link", Selector = ".btn", Attribute = "href" }],
        };

        var (exit, stderr) = await RunAsync(Generate(plan));

        Assert.True(exit == 0, stderr);
        var rows = ReadLines("output.csv");
        Assert.Contains("/page2-btn", rows); // reached page 2 through the link whose label is "Weiter" ("Zurück" has the same class)
        Assert.Contains("/cart", rows);
    }

    [Fact]
    public async Task Static_DiscoveredUrls_LinkSelectorFilteredByText()
    {
        using var server = Server();
        var plan = new ScrapingPlan
        {
            DiscoveredUrls = new DiscoveredUrlsConfig { PageUrl = server.BaseUrl + "nav", LinkSelector = "a.cat:contains(\"Gemüse\")" },
            Steps = [new NavigateStep { Urls = [server.BaseUrl + "c1"] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
        };

        var (exit, stderr) = await RunAsync(Generate(plan));

        Assert.True(exit == 0, stderr);
        var rows = ReadLines("output.csv");
        Assert.Contains("Obst-Seite", rows);       // the start URL itself
        Assert.Contains("Gemüse-Seite", rows);     // discovered through the filtered link
        Assert.Equal(3, rows.Length);              // header + exactly those two (not the "Obst" category link)
    }

    // ---- Browser engine ---------------------------------------------------

    [Theory]
    [InlineData(".btn:contains(\"merken\")", "/wish")]
    [InlineData(".btn:contains('in den warenkorb')", "/cart")]
    [InlineData(".card .btn:contains(\"Vergleich\")", "/compare")]
    public async Task Browser_Flat_PicksTheElementByItsText(string selector, string expectedHref)
    {
        using var server = Server();

        var (exit, stderr) = await RunAsync(Generate(FlatHref(server.BaseUrl, selector, ScrapingEngine.Browser)));

        Assert.True(exit == 0, stderr);
        Assert.Equal(["Link", expectedHref], ReadLines("output.csv"));
    }

    [Fact]
    public async Task Browser_Container_GroupAndFieldFilteredByText()
    {
        using var server = Server();
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
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
                            Name = "Karte", Selector = ".card:contains(\"Vergleichen\")", Repeating = true,
                            Children = [new DataFieldNode { Name = "Wunschliste", Selector = "a:contains(\"merken\")", Mode = ExtractMode.Attribute, Attribute = "href" }],
                        },
                    ],
                },
            ],
        };

        var (exit, stderr) = await RunAsync(Generate(plan));

        Assert.True(exit == 0, stderr);
        Assert.Equal("/wish", XDocument.Load(Path.Combine(_workDir, "output.xml")).Root!.Element("Karte")!.Element("Wunschliste")!.Value);
    }

    [Fact]
    public async Task Browser_ClickAction_PicksTheButtonByItsLabel()
    {
        using var server = new LocalTestServer(
            "<html><body>"
            + "<button onclick=\"document.getElementById('out').textContent='cart'\">In den Warenkorb</button>"
            + "<button onclick=\"document.getElementById('out').textContent='wishlist'\">Merken</button>"
            + "<div id='out'>nothing</div></body></html>");
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ClickStep { Selector = "button:contains(\"merken\")" },
                new WaitForStep { Selector = "#out:contains(\"wishlist\")", TimeoutMs = 5000 },
                new ExtractStep { Name = "Result", Selector = "#out" },
            ],
        };

        var (exit, stderr) = await RunAsync(Generate(plan));

        Assert.True(exit == 0, stderr);
        Assert.Equal(["Result", "wishlist"], ReadLines("output.csv"));
    }

    [Fact]
    public async Task Browser_Pagination_NextLinkPickedByText()
    {
        using var server = Server();
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Pagination = new NextLinkPagination { NextLinkSelector = ".nav:contains(\"Weiter\")", MaxPages = 3 },
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Link", Selector = ".btn", Attribute = "href" }],
        };

        var (exit, stderr) = await RunAsync(Generate(plan));

        Assert.True(exit == 0, stderr);
        Assert.Contains("/page2-btn", ReadLines("output.csv"));
    }

    [Fact]
    public async Task Browser_DiscoveredUrls_LinkSelectorFilteredByText()
    {
        using var server = Server();
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            DiscoveredUrls = new DiscoveredUrlsConfig { PageUrl = server.BaseUrl + "nav", LinkSelector = "a.cat:contains(\"Gemüse\")" },
            Steps = [new NavigateStep { Urls = [server.BaseUrl + "c1"] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
        };

        var (exit, stderr) = await RunAsync(Generate(plan));

        Assert.True(exit == 0, stderr);
        var rows = ReadLines("output.csv");
        Assert.Contains("Gemüse-Seite", rows);
        Assert.Equal(3, rows.Length);
    }

    // ---- scripts without the suffix are untouched --------------------------

    [Fact]
    public void WithoutAFilter_TheScriptContainsNoTextSelectorMachinery()
    {
        var plain = FlatHref("https://example.com", ".btn");

        Assert.DoesNotContain("_split_text_filter", Generate(plain));
        Assert.DoesNotContain("_split_text_filter", Generate(FlatHref("https://example.com", ".btn", ScrapingEngine.Browser)));
    }

    [Fact]
    public void WithAFilter_TheScriptContainsTheHelpersExactlyOnce()
    {
        var staticScript = Generate(FlatHref("https://example.com", ".btn:contains(\"x\")"));
        var browserScript = Generate(FlatHref("https://example.com", ".btn:contains(\"x\")", ScrapingEngine.Browser));

        Assert.Equal(1, CountOccurrences(staticScript, "def _split_text_filter"));
        Assert.Contains("_BsTag.select = ", staticScript);
        Assert.Equal(1, CountOccurrences(browserScript, "def _split_text_filter"));
        Assert.Contains("_patch_locator_factory(", browserScript);
        Assert.DoesNotContain("_BsTag", browserScript); // no bs4 patch unless URL discovery needs one
    }

    private static int CountOccurrences(string text, string needle) =>
        (text.Length - text.Replace(needle, "").Length) / needle.Length;
}

// Through the real /generate endpoint: a malformed filter is rejected with a
// readable message before any script runs; a valid one passes the trial run.
public class TextSelectorEndpointTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    private static StringContent Json(string payload) => new(payload, Encoding.UTF8, "application/json");

    [Fact]
    public async Task Generate_WithAValidTextFilter_PassesTheTrialRun()
    {
        using var server = new LocalTestServer("<html><body><a class='b' href='/x'>Eins</a><a class='b' href='/y'>Zwei</a></body></html>");
        var payload = $$"""
            { "url": "{{server.BaseUrl}}", "fields": [ { "name": "Link", "selector": ".b:contains(\"zwei\")", "attribute": "href" } ] }
            """;

        var response = await _client.PostAsync("/generate", Json(payload));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("_split_text_filter", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Generate_WithAMalformedTextFilter_IsRejectedWithAReadableMessage()
    {
        var payload = """
            { "url": "https://example.com", "fields": [ { "name": "Link", "selector": ".b:contains(zwei)" } ] }
            """;

        var response = await _client.PostAsync("/generate", Json(payload));

        Assert.True(response.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.UnprocessableEntity);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var error = doc.RootElement.GetProperty("error").GetString();
        Assert.Contains("Selector for field 'Link'", error);
        Assert.Contains("quotes", error);
    }
}
