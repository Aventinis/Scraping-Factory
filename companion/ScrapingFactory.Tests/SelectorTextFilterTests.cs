using System.Text.Json;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #227: `:contains("text")` selector suffix. The parser here validates and splits (the Python runtime and
// the extension each have their own copy of the split). Issue #388: all four implementations run the same table,
// test-vectors/text-selector.json — the extension halves are popup/selector-text-filter.test.js and
// content/text-selector-vectors.test.js, the script half is Script_SplitTextFilter_MatchesTheSharedVectors below.
public class SelectorTextFilterTests
{
    private const string VectorFile = "text-selector.json";

    public static IEnumerable<object[]> ValidCases() =>
        TestVectors.Cases(VectorFile).Where(c => !c.TryGetProperty("invalid", out _)).Select(c => new object[] { c.GetProperty("name").GetString()! });

    public static IEnumerable<object[]> InvalidCases() =>
        TestVectors.Cases(VectorFile).Where(c => c.TryGetProperty("invalid", out _)).Select(c => new object[] { c.GetProperty("name").GetString()! });

    [Theory]
    [MemberData(nameof(ValidCases))]
    public void Split_ParsesTheCssPartAndTheText(string name)
    {
        var testCase = TestVectors.Case(VectorFile, name);
        var selector = testCase.GetProperty("selector").GetString()!;

        var (baseSelector, text) = SelectorTextFilter.Split(selector);

        Assert.Equal(testCase.GetProperty("base").GetString(), baseSelector);
        Assert.Equal(testCase.StringOrNull("text"), text);
        Assert.Null(SelectorTextFilter.Validate(selector, "label"));
    }

    [Theory]
    [MemberData(nameof(InvalidCases))]
    public void Validate_MalformedFilter_ReturnsAMessageWithTheLabel(string name)
    {
        var selector = TestVectors.Case(VectorFile, name).GetProperty("selector").GetString()!;

        var error = SelectorTextFilter.Validate(selector, "Selector for field 'F'");

        Assert.NotNull(error);
        Assert.StartsWith("Selector for field 'F': ", error);
        Assert.Throws<FormatException>(() => SelectorTextFilter.Split(selector));
    }

    [Fact]
    public async Task Script_SplitTextFilter_MatchesTheSharedVectors()
    {
        var cases = TestVectors.Cases(VectorFile).Where(c => !c.TryGetProperty("invalid", out _) || c.TryGetProperty("splitUnchanged", out _)).ToList();
        var script = new PythonCodeGenerator().Generate(new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = ["https://example.com/"] }, new ExtractStep { Name = "F", Selector = "a:contains(\"x\")" }],
        });

        var output = await PythonContractHarness.RunAsync(script,
            "result = [list(mod._split_text_filter(selector)) for selector in data]",
            cases.Select(c => c.GetProperty("selector").GetString()).ToList());

        var mismatches = new List<string>();
        for (var i = 0; i < cases.Count; i++)
        {
            var invalid = cases[i].TryGetProperty("invalid", out _);
            var expectedBase = invalid ? cases[i].GetProperty("selector").GetString() : cases[i].GetProperty("base").GetString();
            var expectedText = invalid ? null : cases[i].StringOrNull("text");
            var actualText = output[i][1].ValueKind == JsonValueKind.Null ? null : output[i][1].GetString();
            if (output[i][0].GetString() != expectedBase || actualText != expectedText)
                mismatches.Add($"{cases[i].GetProperty("name").GetString()}: expected ({expectedBase}, {expectedText}), got ({output[i][0]}, {actualText})");
        }
        Assert.True(mismatches.Count == 0, string.Join(Environment.NewLine, mismatches));
    }

    [Fact]
    public void Validate_SelectorWithoutAFilter_IsAlwaysValid()
    {
        Assert.Null(SelectorTextFilter.Validate(".a .b[data-x=\"1\"]", "label"));
        Assert.Null(SelectorTextFilter.Validate(null, "label"));
    }

    [Fact]
    public void ValidateNotAllowed_RejectsAnyFilter()
    {
        Assert.NotNull(SelectorTextFilter.ValidateNotAllowed("iframe:contains(\"x\")", "FramePath"));
        Assert.Null(SelectorTextFilter.ValidateNotAllowed("iframe#a", "FramePath"));
    }
}
