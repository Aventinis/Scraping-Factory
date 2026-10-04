using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #289: real end-to-end proof that ScrollStepPx actually changes
// discovery outcomes in a real browser, not just the rendered script's own
// source text (already covered by PythonPlaywrightCodeGeneratorTests/
// PythonApiCodeGeneratorTests). The fixture page places three
// IntersectionObserver-watched trigger elements at fixed, non-overlapping
// scroll positions along a page whose total height never changes (no
// lazy-growth) — jumping straight from the top to the clamped bottom
// scroll position (today's default) only ever renders two scroll positions
// (0 and the bottom), so only whichever trigger happens to fall in one of
// those two viewports is ever observed; a trigger sitting strictly between
// them is never the current scroll position at any point and therefore
// never intersects, deterministically (no reliance on animation-frame
// timing/flakiness — IntersectionObserver reports intersection relative to
// the *current* scroll position only, regardless of how it was reached).
// Stepping there in fixed increments instead visits every position along
// the way, including the middle trigger.
public class ScrollStepDistanceEndToEndTests
{
    private static ScrapingPlan PlanWith(ApiConfig api) => new()
    {
        Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
        OutputFormat = OutputFormat.Csv,
        Engine = ScrapingEngine.Api,
    };

    private static string GenerateScript(ApiConfig api) => new PythonApiCodeGenerator().Generate(PlanWith(api));

    // Viewport is Playwright's own default (1280x720). Trigger positions
    // (1200, 2600, 4600) are chosen so that trigger-2 falls strictly between
    // the top viewport ([0,720]) and the bottom-clamped viewport
    // ([4480,5200], since total height 5200 - viewport height 720 = 4480) —
    // never visible at either endpoint — while trigger-3 falls inside the
    // bottom viewport and trigger-1 does not fall inside either.
    private const string DiscoveryPageHtml = """
        <html><body style="margin:0;">
        <div style="height:1200px;"></div>
        <div id="trigger-1" style="height:10px;"></div>
        <div style="height:1390px;"></div>
        <div id="trigger-2" style="height:10px;"></div>
        <div style="height:1990px;"></div>
        <div id="trigger-3" style="height:10px;"></div>
        <div style="height:590px;"></div>
        <script>
            function watch(id, url) {
                var el = document.getElementById(id);
                var fired = false;
                new IntersectionObserver(function (entries) {
                    if (fired) return;
                    entries.forEach(function (entry) {
                        if (entry.isIntersecting) { fired = true; fetch(url); }
                    });
                }).observe(el);
            }
            watch('trigger-1', '/rest/offers/by-category/cat1/35');
            watch('trigger-2', '/rest/offers/by-category/cat2/35');
            watch('trigger-3', '/rest/offers/by-category/cat3/35');
        </script>
        </body></html>
        """;

    private static LocalTestServerResponse Responder(System.Net.HttpListenerRequest request)
    {
        var path = request.Url!.AbsolutePath;
        if (path == "/angebote")
            return new LocalTestServerResponse(DiscoveryPageHtml, "text/html; charset=utf-8");

        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var category = segments[^2];
        var json = $$"""{ "items": [ { "name": "{{category}}" } ] }""";
        return new LocalTestServerResponse(json, "application/json");
    }

    private static ApiConfig ApiConfigWithScrollAction(string baseUrl, ScrollAction scroll) => new()
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
                Source = new BrowserDiscoverySource { DiscoveryUrl = $"{baseUrl}angebote", Actions = [scroll] },
            },
        ],
    };

    [Fact]
    public async Task WithoutScrollStepPx_JumpToBottomOnlyDiscoversTheInitiallyAndFinallyVisibleTriggers()
    {
        using var server = new LocalTestServer(Responder);
        var api = ApiConfigWithScrollAction(server.BaseUrl, new ScrollAction { MaxIterations = 20, WaitAfterMs = 150 });

        var result = await new PythonScriptVerifier().VerifyAsync(
            GenerateScript(api), extraTimeout: TimeSpan.FromSeconds(30), includeOutputFile: true);

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, result.RowCount); // only trigger-3, inside the bottom-clamped viewport
        Assert.Contains("cat3", result.OutputFileContent);
        Assert.DoesNotContain("cat1", result.OutputFileContent);
        Assert.DoesNotContain("cat2", result.OutputFileContent);
    }

    [Fact]
    public async Task WithScrollStepPx_IncrementalScrollDiscoversTheMiddleTriggerToo()
    {
        using var server = new LocalTestServer(Responder);
        var api = ApiConfigWithScrollAction(
            server.BaseUrl, new ScrollAction { MaxIterations = 20, WaitAfterMs = 150, ScrollStepPx = 400 });

        var result = await new PythonScriptVerifier().VerifyAsync(
            GenerateScript(api), extraTimeout: TimeSpan.FromSeconds(30), includeOutputFile: true);

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, result.RowCount);
        Assert.Contains("cat1", result.OutputFileContent);
        Assert.Contains("cat2", result.OutputFileContent);
        Assert.Contains("cat3", result.OutputFileContent);
    }
}
