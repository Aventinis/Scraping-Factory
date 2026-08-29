using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class PythonCodeGeneratorTests
{
    private readonly PythonCodeGenerator _generator = new();

    private static ScrapingPlan TwoFieldPlan() => new()
    {
        Steps =
        [
            new NavigateStep { Url = "https://books.toscrape.com" },
            new ExtractStep { Name = "Titel", Selector = "h3 > a" },
            new ExtractStep { Name = "Link", Selector = "h3 > a", Attribute = "href" }
        ]
    };

    [Fact]
    public void Generate_ContainsTargetUrl()
    {
        var script = _generator.Generate(TwoFieldPlan());
        Assert.Contains("https://books.toscrape.com", script);
    }

    [Fact]
    public void Generate_ContainsAllFieldNames()
    {
        var script = _generator.Generate(TwoFieldPlan());
        Assert.Contains("Titel", script);
        Assert.Contains("Link", script);
    }

    [Fact]
    public void Generate_ContainsAllSelectors()
    {
        var script = _generator.Generate(TwoFieldPlan());
        Assert.Contains("h3 > a", script);
    }

    [Fact]
    public void Generate_ContainsPythonImports()
    {
        var script = _generator.Generate(TwoFieldPlan());
        Assert.Contains("import requests", script);
        Assert.Contains("from bs4 import BeautifulSoup", script);
    }

    [Fact]
    public void Generate_ContainsCsvDictWriter()
    {
        var script = _generator.Generate(TwoFieldPlan());
        Assert.Contains("csv.DictWriter", script);
    }

    [Fact]
    public void Generate_ParsesResponseContentNotText()
    {
        // requests.Response.text guesses the encoding from the Content-Type
        // header and falls back to ISO-8859-1 when no charset is given,
        // mangling UTF-8 pages that only declare their charset via
        // <meta charset>. response.content (bytes) lets BeautifulSoup detect
        // that meta tag itself, so the generated script must use it.
        var script = _generator.Generate(TwoFieldPlan());
        Assert.Contains("BeautifulSoup(response.content,", script);
        Assert.DoesNotContain("BeautifulSoup(response.text,", script);
    }

    [Fact]
    public void Generate_AttributeFieldAppearsInAttributesDict()
    {
        var script = _generator.Generate(TwoFieldPlan());
        Assert.Contains("\"Link\": \"href\"", script);
    }

    [Fact]
    public void Generate_FieldWithoutAttributeNotInAttributesDict()
    {
        var script = _generator.Generate(TwoFieldPlan());
        // "Titel" has no attribute — must not appear in ATTRIBUTES block
        var attributesSection = script[(script.IndexOf("ATTRIBUTES") + "ATTRIBUTES".Length)..];
        Assert.DoesNotContain("\"Titel\"", attributesSection.Split("def scrape")[0]);
    }

    [Fact]
    public void Generate_DefaultsToScraperAndOutputFileNames()
    {
        var script = _generator.Generate(TwoFieldPlan());
        Assert.Contains("python scraper.py", script);
        Assert.Contains("open(\"output.csv\"", script);
        Assert.Contains("written to output.csv", script);
    }

    [Fact]
    public void Generate_UsesConfiguredFileNames()
    {
        var plan = TwoFieldPlan();
        plan = new ScrapingPlan
        {
            Steps = plan.Steps, OutputFormat = plan.OutputFormat, Engine = plan.Engine,
            ScriptFileName = "mein_scraper", OutputFileBaseName = "ergebnisse",
        };

        var script = _generator.Generate(plan);

        Assert.Contains("python mein_scraper.py", script);
        Assert.Contains("open(\"ergebnisse.csv\"", script);
        Assert.Contains("written to ergebnisse.csv", script);
        Assert.DoesNotContain("output.csv", script);
    }
}
