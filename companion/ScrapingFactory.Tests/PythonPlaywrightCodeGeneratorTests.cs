using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class PythonPlaywrightCodeGeneratorTests
{
    private readonly PythonPlaywrightCodeGenerator _generator = new();

    private static ScrapingPlan PlanWithoutWait() => new()
    {
        Engine = ScrapingEngine.Browser,
        Steps =
        [
            new NavigateStep { Url = "https://books.toscrape.com" },
            new ExtractStep { Name = "Titel", Selector = "h3 > a" },
            new ExtractStep { Name = "Link", Selector = "h3 > a", Attribute = "href" },
        ],
    };

    private static ScrapingPlan PlanWithWait() => new()
    {
        Engine = ScrapingEngine.Browser,
        Steps =
        [
            new NavigateStep { Url = "https://books.toscrape.com" },
            new WaitForStep { Selector = ".loaded", TimeoutMs = 7000 },
            new ExtractStep { Name = "Titel", Selector = "h3 > a" },
        ],
    };

    private static ScrapingPlan LoginPlan() => new()
    {
        Engine = ScrapingEngine.Browser,
        Steps =
        [
            new NavigateStep { Url = "https://example.com/login" },
            new FillStep { Selector = "#username", EnvironmentVariableName = "SF_USERNAME" },
            new FillStep { Selector = "#password", EnvironmentVariableName = "SF_PASSWORD" },
            new ClickStep { Selector = "#submit" },
            new ExtractStep { Name = "Titel", Selector = "h1" },
        ],
    };

    [Fact]
    public void Generate_ContainsTargetUrl()
    {
        var script = _generator.Generate(PlanWithoutWait());
        Assert.Contains("https://books.toscrape.com", script);
    }

    [Fact]
    public void Generate_ContainsPlaywrightImport()
    {
        var script = _generator.Generate(PlanWithoutWait());
        Assert.Contains("from playwright.sync_api import sync_playwright", script);
    }

    [Fact]
    public void Generate_ContainsPageGoto()
    {
        var script = _generator.Generate(PlanWithoutWait());
        Assert.Contains("page.goto(\"https://books.toscrape.com\"", script);
    }

    [Fact]
    public void Generate_WithoutWaitForStep_DoesNotContainWaitForSelector()
    {
        var script = _generator.Generate(PlanWithoutWait());
        Assert.DoesNotContain("wait_for_selector", script);
    }

    [Fact]
    public void Generate_WithWaitForStep_ContainsWaitForSelectorWithTimeout()
    {
        var script = _generator.Generate(PlanWithWait());
        Assert.Contains("page.wait_for_selector(\".loaded\", timeout=7000)", script);
    }

    [Fact]
    public void Generate_AttributeFieldAppearsInAttributesDict()
    {
        var script = _generator.Generate(PlanWithoutWait());
        Assert.Contains("\"Link\": \"href\"", script);
    }

    [Fact]
    public void Generate_ContainsCsvDictWriter()
    {
        var script = _generator.Generate(PlanWithoutWait());
        Assert.Contains("csv.DictWriter", script);
    }

    [Fact]
    public void Generate_WithoutFillStep_DoesNotImportOs()
    {
        var script = _generator.Generate(PlanWithoutWait());
        Assert.DoesNotContain("import os", script);
    }

    [Fact]
    public void Generate_WithFillStep_ImportsOs()
    {
        var script = _generator.Generate(LoginPlan());
        Assert.Contains("import os", script);
    }

    [Fact]
    public void Generate_WithFillStep_ReadsValueFromEnvironmentVariable()
    {
        var script = _generator.Generate(LoginPlan());
        Assert.Contains("page.fill(\"#username\", os.environ[\"SF_USERNAME\"])", script);
        Assert.Contains("page.fill(\"#password\", os.environ[\"SF_PASSWORD\"])", script);
    }

    [Fact]
    public void Generate_WithClickStep_ContainsPageClick()
    {
        var script = _generator.Generate(LoginPlan());
        Assert.Contains("page.click(\"#submit\")", script);
    }
}
