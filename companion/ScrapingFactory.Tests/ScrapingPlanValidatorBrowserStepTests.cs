using ScrapingFactory.Compiler.IR;
using Xunit;
using static ScrapingFactory.Tests.ValidatorTestPlans;

namespace ScrapingFactory.Tests;

// Browser-only steps and frame paths: WaitFor/Fill/Click, ScrollStep, FramePath. (ScrapingPlanValidator; the plan builders are in ValidatorTestPlans.)
public class ScrapingPlanValidatorBrowserStepTests
{
    [Fact]
    public void Validate_ValidWaitForStep_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new WaitForStep { Selector = ".loaded", TimeoutMs = 3000 },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success);
    }

    [Fact]
    public void Validate_WaitForStepWithEmptySelector_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new WaitForStep { Selector = " " },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("WaitForStep", result.Error);
    }

    [Fact]
    public void Validate_WaitForStepWithNonPositiveTimeout_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new WaitForStep { Selector = ".loaded", TimeoutMs = 0 },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Timeout", result.Error);
    }

    [Fact]
    public void Validate_BrowserOnlyStepWithStaticEngine_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Static,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new WaitForStep { Selector = ".loaded" },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Engine", result.Error);
    }

    [Fact]
    public void Validate_ValidFillAndClickSteps_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com/login"] },
                new FillStep { Selector = "#user", EnvironmentVariableName = "SF_USERNAME" },
                new ClickStep { Selector = "#submit" },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success);
    }

    [Fact]
    public void Validate_FillStepWithEmptySelector_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new FillStep { Selector = " ", EnvironmentVariableName = "SF_USERNAME" },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("FillStep", result.Error);
    }

    [Theory]
    [InlineData("")]
    [InlineData("1BAD")]
    [InlineData("BAD NAME")]
    [InlineData("BAD-NAME")]
    public void Validate_FillStepWithInvalidEnvironmentVariableName_Fails(string envVarName)
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new FillStep { Selector = "#user", EnvironmentVariableName = envVarName },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("environment variable name", result.Error);
    }

    [Fact]
    public void Validate_ClickStepWithEmptySelector_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ClickStep { Selector = " " },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("ClickStep", result.Error);
    }

    [Fact]
    public void Validate_ValidScrollStep_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ScrollStep { ContainerSelector = "#list", LoadMoreButtonSelector = ".more", MaxIterations = 5, WaitAfterMs = 500 },
                new ExtractStep { Name = "Titel", Selector = ".item" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ScrollStepWithStaticEngine_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Static,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ScrollStep(),
                new ExtractStep { Name = "Titel", Selector = ".item" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Engine", result.Error);
    }

    [Fact]
    public void Validate_ScrollStepWithBlankContainerSelector_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ScrollStep { ContainerSelector = " " },
                new ExtractStep { Name = "Titel", Selector = ".item" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("ContainerSelector", result.Error);
    }

    [Fact]
    public void Validate_ScrollStepWithBlankLoadMoreButtonSelector_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ScrollStep { LoadMoreButtonSelector = " " },
                new ExtractStep { Name = "Titel", Selector = ".item" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("LoadMoreButtonSelector", result.Error);
    }

    [Fact]
    public void Validate_ScrollStepWithNonPositiveMaxIterations_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ScrollStep { MaxIterations = 0 },
                new ExtractStep { Name = "Titel", Selector = ".item" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("MaxIterations", result.Error);
    }

    [Fact]
    public void Validate_ScrollStepWithNegativeWaitAfterMs_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ScrollStep { WaitAfterMs = -1 },
                new ExtractStep { Name = "Titel", Selector = ".item" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("WaitAfterMs", result.Error);
    }

    // Issue #289
    [Fact]
    public void Validate_ScrollStepWithPositiveScrollStepPx_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ScrollStep { ScrollStepPx = 400 },
                new ExtractStep { Name = "Titel", Selector = ".item" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ScrollStepWithNonPositiveScrollStepPx_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ScrollStep { ScrollStepPx = 0 },
                new ExtractStep { Name = "Titel", Selector = ".item" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("ScrollStepPx", result.Error);
    }

    [Fact]
    public void Validate_ValidFramedActionSteps_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new FillStep { Selector = "#user", EnvironmentVariableName = "SF_USER", FramePath = ["iframe#sso"] },
                new ClickStep { Selector = "#submit", FramePath = ["iframe#sso"] },
                new WaitForStep { Selector = ".welcome", FramePath = ["iframe#sso"] },
                new ScrollStep { LoadMoreButtonSelector = "#more", FramePath = ["iframe#sso"] },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_FramedWaitForStepWithEmptyFramePath_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new WaitForStep { Selector = ".welcome", FramePath = [] },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("FramePath", result.Error);
    }

    [Fact]
    public void Validate_FramedFillStepWithBlankFramePathSegment_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new FillStep { Selector = "#user", EnvironmentVariableName = "SF_USER", FramePath = [" "] },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("FramePath", result.Error);
    }

    [Fact]
    public void Validate_FramedClickStepWithEmptyFramePath_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ClickStep { Selector = "#submit", FramePath = [] },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("FramePath", result.Error);
    }

    [Fact]
    public void Validate_FramedScrollStepWithEmptyFramePath_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ScrollStep { LoadMoreButtonSelector = "#more", FramePath = [] },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("FramePath", result.Error);
    }

    [Fact]
    public void Validate_DuplicateFieldNames_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = "Titel", Selector = "h1" },
                new ExtractStep { Name = "Titel", Selector = "h2" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Duplicate field names", result.Error);
        Assert.Contains("Titel", result.Error);
    }

    [Fact]
    public void Validate_ValidFramePath_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = "Preis", Selector = ".price", FramePath = ["iframe#outer", "iframe.inner"] },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_FramePathWithStaticEngine_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Static,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = "Preis", Selector = ".price", FramePath = ["iframe#outer"] },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Engine", result.Error);
        Assert.Contains("Preis", result.Error);
    }

    [Fact]
    public void Validate_EmptyFramePath_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = "Preis", Selector = ".price", FramePath = [] },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("FramePath", result.Error);
    }

    [Fact]
    public void Validate_FramePathWithBlankSegment_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = "Preis", Selector = ".price", FramePath = ["iframe#outer", " "] },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("FramePath", result.Error);
    }

    [Fact]
    public void Validate_NullFramePath_SucceedsWithStaticEngine()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Static,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }
}
