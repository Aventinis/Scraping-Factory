using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class FileNameSanitizerTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void SanitizeBaseName_FallsBackForEmptyOrWhitespaceInput(string? input)
    {
        Assert.Equal("fallback", FileNameSanitizer.SanitizeBaseName(input, "fallback"));
    }

    [Fact]
    public void SanitizeBaseName_CollapsesPathSeparatorsAndPreventsTraversal()
    {
        Assert.Equal("etc_passwd", FileNameSanitizer.SanitizeBaseName("../../etc/passwd", "fallback"));
    }

    [Fact]
    public void SanitizeBaseName_ReplacesSpacesAndQuotes()
    {
        Assert.Equal("my_scraper", FileNameSanitizer.SanitizeBaseName("my scraper!", "fallback"));
        Assert.Equal("a_b_c", FileNameSanitizer.SanitizeBaseName("a\"b'c", "fallback"));
    }

    [Fact]
    public void SanitizeBaseName_KeepsLettersDigitsUnderscoreAndHyphen()
    {
        Assert.Equal("my-scraper_v2", FileNameSanitizer.SanitizeBaseName("my-scraper_v2", "fallback"));
    }

    [Fact]
    public void SanitizeBaseName_FallsBackWhenEverythingIsStripped()
    {
        Assert.Equal("fallback", FileNameSanitizer.SanitizeBaseName("///", "fallback"));
        Assert.Equal("fallback", FileNameSanitizer.SanitizeBaseName("...", "fallback"));
    }
}
