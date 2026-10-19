using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #227: `:contains("text")` selector suffix. The parser here only
// *validates* (the Python runtime and the extension's content script each have
// their own copy of the split) — the cases below are mirrored one-to-one in
// extension/popup/selector-text-filter.test.js, so the three implementations
// are checked against identical expectations.
public class SelectorTextFilterTests
{
    [Theory]
    [InlineData(".btn:contains(\"Add to cart\")", ".btn", "Add to cart")]
    [InlineData(".card .btn:contains('Merken')", ".card .btn", "Merken")]
    [InlineData("a:contains(  \"x\"  )   ", "a", "x")]
    [InlineData(":contains(\"only\")", "*", "only")]
    [InlineData(".a > .b:contains(\"say \\\"hi\\\"\")", ".a > .b", "say \"hi\"")]
    [InlineData(".b:contains('it\\'s')", ".b", "it's")]
    [InlineData("A:CONTAINS(\"x\")", "A", "x")]
    [InlineData("div", "div", null)]
    public void Split_ParsesTheCssPartAndTheText(string selector, string expectedBase, string? expectedText)
    {
        var (baseSelector, text) = SelectorTextFilter.Split(selector);

        Assert.Equal(expectedBase, baseSelector);
        Assert.Equal(expectedText, text);
        Assert.Null(SelectorTextFilter.Validate(selector, "label"));
    }

    [Theory]
    [InlineData("a:contains(x)")]
    [InlineData("a:contains(\"x\"")]
    [InlineData("a:contains(\"x\") b")]
    [InlineData("a:contains(\"\")")]
    [InlineData("a:contains(\"   \")")]
    [InlineData("a:contains(\"x\"):contains(\"y\")")]
    [InlineData("a:contains(")]
    public void Validate_MalformedFilter_ReturnsAMessageWithTheLabel(string selector)
    {
        var error = SelectorTextFilter.Validate(selector, "Selector for field 'F'");

        Assert.NotNull(error);
        Assert.StartsWith("Selector for field 'F': ", error);
        Assert.Throws<FormatException>(() => SelectorTextFilter.Split(selector));
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
