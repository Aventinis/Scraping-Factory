using ScrapingFactory.Compiler.Backends;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #326: the compiler-side `#@include <name>` directive that lets the
// Python templates share runtime helpers (see EmbeddedScribanTemplate).
public class TemplateIncludeTests
{
    private static Func<string, string?> Fragments(params (string Name, string Text)[] fragments)
    {
        var map = fragments.ToDictionary(f => f.Name, f => f.Text);
        return name => map.GetValueOrDefault(name);
    }

    [Fact]
    public void Expand_ReplacesTheDirectiveLineWithTheFragmentText()
    {
        var result = EmbeddedScribanTemplate.ExpandIncludes(
            "before\n#@include helper\nafter\n", Fragments(("helper", "def f():\n    return 1\n")), "t");

        Assert.Equal("before\ndef f():\n    return 1\nafter\n", result);
    }

    // Extracting a block verbatim into a fragment and including it back must
    // reproduce the original text exactly, whatever line endings follow it.
    [Theory]
    [InlineData("a\n#@include h\nb", "X", "a\nX\nb")]
    [InlineData("a\n#@include h\n\n\nb", "X\n\n", "a\nX\n\n\nb")]
    [InlineData("#@include h", "X", "X")]
    [InlineData("a\r\n#@include h\r\nb", "X\r\n", "a\r\nX\r\nb")]
    public void Expand_TrailingLineBreaksOfTheFragmentAreNotDuplicated(string template, string fragment, string expected)
    {
        Assert.Equal(expected, EmbeddedScribanTemplate.ExpandIncludes(template, Fragments(("h", fragment)), "t"));
    }

    [Fact]
    public void Expand_ReindentsEveryNonBlankLineToTheDirectivesIndentation()
    {
        var result = EmbeddedScribanTemplate.ExpandIncludes(
            "def main():\n    #@include body\n    done()\n", Fragments(("body", "a()\n\nif x:\n    b()\n")), "t");

        Assert.Equal("def main():\n    a()\n\n    if x:\n        b()\n    done()\n", result);
    }

    [Fact]
    public void Expand_SupportsNestedIncludes()
    {
        var result = EmbeddedScribanTemplate.ExpandIncludes(
            "#@include outer\n", Fragments(("outer", "1\n  #@include inner\n3"), ("inner", "2")), "t");

        Assert.Equal("1\n  2\n3\n", result);
    }

    [Fact]
    public void Expand_SameFragmentMayBeIncludedTwiceSideBySide()
    {
        var result = EmbeddedScribanTemplate.ExpandIncludes("#@include h\n#@include h\n", Fragments(("h", "X")), "t");
        Assert.Equal("X\nX\n", result);
    }

    [Fact]
    public void Expand_OnlyWholeLineDirectivesCount()
    {
        const string text = "x = 1  #@include h\n# not #@include h\n";
        Assert.Equal(text, EmbeddedScribanTemplate.ExpandIncludes(text, Fragments(("h", "X")), "t"));
    }

    [Fact]
    public void Expand_UnknownFragment_FailsNamingTheFragmentAndTheIncludingTemplate()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            EmbeddedScribanTemplate.ExpandIncludes("#@include missing\n", Fragments(), "scraper.py.j2"));

        Assert.Contains("'missing'", ex.Message);
        Assert.Contains("scraper.py.j2", ex.Message);
    }

    [Fact]
    public void Expand_CircularInclude_Fails()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            EmbeddedScribanTemplate.ExpandIncludes("#@include a\n", Fragments(("a", "#@include b"), ("b", "#@include a")), "t"));

        Assert.Contains("Circular", ex.Message);
    }

    [Fact]
    public void Expand_FragmentIncludingItself_Fails()
    {
        Assert.Throws<InvalidOperationException>(() =>
            EmbeddedScribanTemplate.ExpandIncludes("#@include a\n", Fragments(("a", "#@include a")), "t"));
    }

    // The directive must never survive into a generated script, and every
    // template must still parse after expansion.
    [Fact]
    public void EveryEmbeddedTemplateStillParsesAfterExpansion()
    {
        var assembly = typeof(EmbeddedScribanTemplate).Assembly;
        foreach (var name in assembly.GetManifestResourceNames().Where(n => n.EndsWith(".py.j2") && !n.StartsWith("fragments/")))
            Assert.NotNull(EmbeddedScribanTemplate.Load(assembly, name));
    }
}
