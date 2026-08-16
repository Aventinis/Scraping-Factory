using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class PythonCodeGeneratorTests
{
    private readonly PythonCodeGenerator _generator = new();

    private static ScrapingConfig TwoFieldConfig() => new()
    {
        Url = "https://books.toscrape.com",
        Fields =
        [
            new ScrapingField { Name = "Titel", Selector = "h3 > a" },
            new ScrapingField { Name = "Link",  Selector = "h3 > a", Attribute = "href" }
        ]
    };

    [Fact]
    public void Generate_ContainsTargetUrl()
    {
        var script = _generator.Generate(TwoFieldConfig());
        Assert.Contains("https://books.toscrape.com", script);
    }

    [Fact]
    public void Generate_ContainsAllFieldNames()
    {
        var script = _generator.Generate(TwoFieldConfig());
        Assert.Contains("Titel", script);
        Assert.Contains("Link", script);
    }

    [Fact]
    public void Generate_ContainsAllSelectors()
    {
        var script = _generator.Generate(TwoFieldConfig());
        Assert.Contains("h3 > a", script);
    }

    [Fact]
    public void Generate_ContainsPythonImports()
    {
        var script = _generator.Generate(TwoFieldConfig());
        Assert.Contains("import requests", script);
        Assert.Contains("from bs4 import BeautifulSoup", script);
    }

    [Fact]
    public void Generate_ContainsCsvDictWriter()
    {
        var script = _generator.Generate(TwoFieldConfig());
        Assert.Contains("csv.DictWriter", script);
    }

    [Fact]
    public void Generate_AttributeFieldAppearsInAttributesDict()
    {
        var script = _generator.Generate(TwoFieldConfig());
        Assert.Contains("\"Link\": \"href\"", script);
    }

    [Fact]
    public void Generate_FieldWithoutAttributeNotInAttributesDict()
    {
        var script = _generator.Generate(TwoFieldConfig());
        // "Titel" has no attribute — must not appear in ATTRIBUTES block
        var attributesSection = script[(script.IndexOf("ATTRIBUTES") + "ATTRIBUTES".Length)..];
        Assert.DoesNotContain("\"Titel\"", attributesSection.Split("def scrape")[0]);
    }
}
