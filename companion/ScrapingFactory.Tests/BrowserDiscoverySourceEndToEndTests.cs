using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #216: real end-to-end proof that BrowserDiscoverySource actually
// resolves category-style values at script runtime — same "prove the real
// artifact works" philosophy as PythonApiScriptVerifierTests' own
// StaticListSource/DiscoverySource/RangeSource coverage, just driving a real
// Playwright/Chromium session instead of a plain requests.get. Mirrors the
// motivating penny.de case directly: a fixed {week} (a plain StaticListSource
// here, for determinism) and a discovered {category}, both substituted into
// the same UrlTemplate the main request itself uses — BrowserDiscoverySource
// deliberately carries no URL-match-pattern field of its own (see its IR
// doc comment), so this also proves the runtime correctly matches captured
// requests against UrlTemplate rather than some separate configured shape.
public class BrowserDiscoverySourceEndToEndTests
{
    private static ScrapingPlan PlanWith(ApiConfig api) => new()
    {
        Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
        OutputFormat = OutputFormat.Csv,
        Engine = ScrapingEngine.Api,
    };

    private static string GenerateScript(ApiConfig api) => new PythonApiCodeGenerator().Generate(PlanWith(api));

    // /angebote renders two category links whose onclick handler fires the
    // real category-specific requests directly — deterministic and
    // independent of actual scroll/viewport physics, unlike a real
    // IntersectionObserver-triggered lazy load would be. The test's own
    // BrowserDiscoverySource.Actions then drives this via a ClickAction,
    // proving the action-replay path (not just the URL-matching logic)
    // actually runs.
    private const string DiscoveryPageHtml = """
        <html><body>
        <button id="load-categories" onclick="
            fetch('/rest/offers/by-category/milch/35');
            fetch('/rest/offers/by-category/kaese/35');
        ">Load categories</button>
        </body></html>
        """;

    private static LocalTestServerResponse Responder(System.Net.HttpListenerRequest request)
    {
        var path = request.Url!.AbsolutePath;
        if (path == "/angebote")
            return new LocalTestServerResponse(DiscoveryPageHtml, "text/html; charset=utf-8");

        // /rest/offers/by-category/{category}/{week}
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var category = segments[^2];
        var json = $$"""{ "items": [ { "name": "{{category}}" } ] }""";
        return new LocalTestServerResponse(json, "application/json");
    }

    private static ApiConfig ApiConfigWithBrowserDiscovery(string baseUrl, List<BrowserAction>? actions) => new()
    {
        UrlTemplate = $"{baseUrl}rest/offers/by-category/{{category}}/{{week}}",
        ItemsPath = "items",
        Fields = [new ApiField { Name = "Name", Path = "name" }],
        Parameters =
        [
            new ApiParameter { Name = "week", Source = new StaticListSource { Values = ["35"] } },
            new ApiParameter
            {
                Name = "category",
                Source = new BrowserDiscoverySource { DiscoveryUrl = $"{baseUrl}angebote", Actions = actions },
            },
        ],
    };

    [Fact]
    public async Task ClickActionTriggersRequests_HarvestsCategoryValuesFromUrlTemplate_Succeeds()
    {
        using var server = new LocalTestServer(Responder);
        var api = ApiConfigWithBrowserDiscovery(server.BaseUrl, [new ClickAction { Selector = "#load-categories" }]);

        var result = await new PythonScriptVerifier().VerifyAsync(
            GenerateScript(api), extraTimeout: TimeSpan.FromSeconds(30), includeOutputFile: true);

        Assert.True(result.Success, result.Error);
        Assert.Equal(2, result.RowCount); // one row per discovered category
        Assert.Contains("milch", result.OutputFileContent);
        Assert.Contains("kaese", result.OutputFileContent);
    }

    // No Actions at all — just load DiscoveryUrl and observe whatever fires
    // natively (here: nothing, since the fixture page only fires its own
    // fetches on the button's onclick) — proves a parameter genuinely
    // resolving to zero values doesn't crash the script, it just makes that
    // parameter's own value list empty, which (via itertools.product) means
    // zero combinations are tried overall — the existing "at least one row"
    // success check then correctly reports this as a failed trial run, same
    // as any other misconfiguration that yields no data.
    [Fact]
    public async Task NoMatchingRequestsObserved_YieldsNoRowsAndFailsVerification()
    {
        using var server = new LocalTestServer(Responder);
        var api = ApiConfigWithBrowserDiscovery(server.BaseUrl, actions: null);

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api), extraTimeout: TimeSpan.FromSeconds(30));

        // Distinguishes a clean "ran fine, just resolved zero values" run
        // (the expected outcome here) from the script crashing outright
        // (e.g. a NameError from a broken _resolve_browser_discovery) —
        // both would otherwise satisfy a bare Assert.False(result.Success).
        Assert.False(result.Success);
        Assert.Contains("returned no data", result.Error);
    }
}
