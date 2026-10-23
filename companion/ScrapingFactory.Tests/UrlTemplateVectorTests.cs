using System.Text.Json;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #388: the generated script's _match_url_against_template (browser discovery) against
// test-vectors/url-template.json — the table the extension's findUrlTemplateMatches also runs
// (popup/url-template-vectors.test.js). The script's own harvest loop (dedupe, first-seen order, skipping empty
// values) is part of the contract, so the harness repeats exactly what BrowserDiscovery does with each match.
public class UrlTemplateVectorTests
{
    private const string VectorFile = "url-template.json";

    private static string BrowserDiscoveryScript() => new PythonApiCodeGenerator().Generate(new ScrapingPlan
    {
        Steps =
        [
            new NavigateStep { Urls = ["https://example.com"] },
            new ApiCallStep
            {
                Config = new ApiConfig
                {
                    UrlTemplate = "https://example.com/api/{cat}",
                    ItemsPath = "items",
                    Fields = [new ApiField { Name = "A", Path = "a" }],
                    Parameters = [new ApiParameter { Name = "cat", Source = new BrowserDiscoverySource { DiscoveryUrl = "https://example.com/" } }],
                },
            },
        ],
        OutputFormat = OutputFormat.Csv,
        Engine = ScrapingEngine.Api,
    });

    [Fact]
    public async Task Script_MatchUrlAgainstTemplate_MatchesTheSharedVectors()
    {
        var cases = TestVectors.Cases(VectorFile);
        var input = cases.Select(c => new
        {
            template = c.GetProperty("template").GetString(),
            target = c.GetProperty("target").GetString(),
            candidates = c.GetProperty("candidates").EnumerateArray().Select(x => x.GetString()).ToList(),
        }).ToList();

        var output = await PythonContractHarness.RunAsync(BrowserDiscoveryScript(), """
            result = []
            for item in data:
                discovered, seen = [], set()
                for url in item["candidates"]:
                    value = mod._match_url_against_template(url, item["template"], item["target"])
                    if value and value not in seen:
                        seen.add(value)
                        discovered.append(value)
                result.append(discovered)
            """, input);

        var mismatches = new List<string>();
        for (var i = 0; i < cases.Count; i++)
        {
            var expected = cases[i].GetProperty("expected").EnumerateArray().Select(v => v.GetString()).ToList();
            var actual = output[i].EnumerateArray().Select(v => v.GetString()).ToList();
            if (!expected.SequenceEqual(actual))
                mismatches.Add($"{cases[i].GetProperty("name").GetString()}: expected [{string.Join(", ", expected)}], script gave [{string.Join(", ", actual)}]");
        }
        Assert.True(mismatches.Count == 0, string.Join(Environment.NewLine, mismatches));
    }

    [Fact]
    public void BrowserDiscovery_SkipsAnEmptyValueLikeTheExtensionDoes()
    {
        // The vectors pin the JS side to "an empty value is not a value"; the script's harvest loop has to drop it too,
        // otherwise a recorded "?cat=" would become a parameter value that requests "/api/" with an empty category.
        Assert.Contains("if value and value not in seen:", BrowserDiscoveryScript());
    }
}
