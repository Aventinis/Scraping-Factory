using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #217: real end-to-end proof that a DiscoverySource/BrowserDiscoverySource
// whose own template references an earlier-declared parameter is actually
// resolved per distinct combination of that earlier value — not once,
// globally, the way every parameter was resolved before this issue. Both
// fixtures below use the same motivating shape (a "category" resolved first,
// a "week" whose own valid values depend on which category was picked) and
// assert on the exact per-category rows produced, not just a total row
// count, since a coincidentally-matching total wouldn't prove the
// per-category filtering actually happened (e.g. a bug resolving `week`
// globally against one arbitrary category would still produce *some* rows,
// just the wrong ones).
public class ChainedParameterDiscoveryEndToEndTests
{
    private static ScrapingPlan PlanWith(ApiConfig api) => new()
    {
        Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
        OutputFormat = OutputFormat.Csv,
        Engine = ScrapingEngine.Api,
    };

    private static string GenerateScript(ApiConfig api) => new PythonApiCodeGenerator().Generate(PlanWith(api));

    // "milch" has two valid weeks, "kaese" has one, and an unsubstituted
    // literal "{category}" (what a pre-#217 build would request, since it
    // never substituted anything into DiscoverySource.UrlTemplate) resolves
    // to zero weeks — so a regression back to "resolve once, globally"
    // would make the whole run fail with "no data" instead of silently
    // producing a plausible-looking but wrong row count.
    private static readonly Dictionary<string, string[]> WeeksByCategory = new()
    {
        ["milch"] = ["1", "2"],
        ["kaese"] = ["3"],
    };

    [Fact]
    public async Task DiscoverySourceReferencingEarlierParameter_ResolvesPerCombination()
    {
        using var server = new LocalTestServer(request =>
        {
            var segments = request.Url!.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (segments is ["categories", var category, "weeks"])
            {
                var weeks = WeeksByCategory.GetValueOrDefault(category, []);
                var itemsJson = string.Join(",", weeks.Select(w => $$"""{"id": "{{w}}"}"""));
                return new LocalTestServerResponse($$"""{ "weeks": [{{itemsJson}}] }""", "application/json");
            }
            // /items/{category}/{week}
            var itemCategory = segments[1];
            var week = segments[2];
            return new LocalTestServerResponse($$"""{ "items": [ { "name": "{{itemCategory}}-{{week}}" } ] }""", "application/json");
        });

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}items/{{category}}/{{week}}",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Name", Path = "name" }],
            Parameters =
            [
                new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["milch", "kaese"] } },
                new ApiParameter
                {
                    Name = "week",
                    Source = new DiscoverySource
                    {
                        UrlTemplate = $"{server.BaseUrl}categories/{{category}}/weeks",
                        ItemsPath = "weeks",
                        ValuePath = "id",
                    },
                },
            ],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(
            GenerateScript(api), extraTimeout: TimeSpan.FromSeconds(30), includeOutputFile: true);

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, result.RowCount); // milch-1, milch-2, kaese-3 — not the 4 a naive 2x2 cross product would give
        Assert.Contains("milch-1", result.OutputFileContent);
        Assert.Contains("milch-2", result.OutputFileContent);
        Assert.Contains("kaese-3", result.OutputFileContent);
        Assert.DoesNotContain("kaese-1", result.OutputFileContent);
        Assert.DoesNotContain("kaese-2", result.OutputFileContent);
        Assert.DoesNotContain("milch-3", result.OutputFileContent);
    }

    // Same shape as above, but the dependent parameter is a
    // BrowserDiscoverySource whose own DiscoveryUrl (not just a plain
    // DiscoverySource.UrlTemplate) references the earlier category — proves
    // the substitution also reaches the throwaway Playwright session's own
    // page.goto(...) call, not just the plain requests.get(...) path.
    [Fact]
    public async Task BrowserDiscoverySourceReferencingEarlierParameter_ResolvesPerCombination()
    {
        using var server = new LocalTestServer(request =>
        {
            var segments = request.Url!.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (segments is ["categories", var category])
            {
                var weeks = WeeksByCategory.GetValueOrDefault(category, []);
                var fetches = string.Join("\n", weeks.Select(w => $"fetch('/items/{category}/{w}');"));
                var html = $"""<html><body><button id="load-weeks" onclick="{fetches}">Load</button></body></html>""";
                return new LocalTestServerResponse(html, "text/html; charset=utf-8");
            }
            // /items/{category}/{week}
            var itemCategory = segments[1];
            var week = segments[2];
            return new LocalTestServerResponse($$"""{ "items": [ { "name": "{{itemCategory}}-{{week}}" } ] }""", "application/json");
        });

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}items/{{category}}/{{week}}",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Name", Path = "name" }],
            Parameters =
            [
                new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["milch", "kaese"] } },
                new ApiParameter
                {
                    Name = "week",
                    Source = new BrowserDiscoverySource
                    {
                        DiscoveryUrl = $"{server.BaseUrl}categories/{{category}}",
                        Actions = [new ClickAction { Selector = "#load-weeks" }],
                    },
                },
            ],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(
            GenerateScript(api), extraTimeout: TimeSpan.FromSeconds(30), includeOutputFile: true);

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, result.RowCount);
        Assert.Contains("milch-1", result.OutputFileContent);
        Assert.Contains("milch-2", result.OutputFileContent);
        Assert.Contains("kaese-3", result.OutputFileContent);
        Assert.DoesNotContain("kaese-1", result.OutputFileContent);
        Assert.DoesNotContain("kaese-2", result.OutputFileContent);
        Assert.DoesNotContain("milch-3", result.OutputFileContent);
    }
}
