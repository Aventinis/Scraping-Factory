using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class ScrapingPlanValidatorTests
{
    private static ScrapingPlan ValidPlan() => new()
    {
        Steps =
        [
            new NavigateStep { Url = "https://example.com" },
            new ExtractStep { Name = "Titel", Selector = "h1" },
        ],
    };

    [Fact]
    public void Validate_ValidPlan_Succeeds()
    {
        var result = ScrapingPlanValidator.Validate(ValidPlan());
        Assert.True(result.Success);
        Assert.Null(result.Error);
    }

    [Fact]
    public void Validate_NoSteps_Fails()
    {
        var result = ScrapingPlanValidator.Validate(new ScrapingPlan());
        Assert.False(result.Success);
        Assert.Contains("NavigateStep", result.Error);
    }

    [Fact]
    public void Validate_DoesNotStartWithNavigateStep_Fails()
    {
        var plan = new ScrapingPlan { Steps = [new ExtractStep { Name = "Titel", Selector = "h1" }] };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("NavigateStep", result.Error);
    }

    [Fact]
    public void Validate_MultipleNavigateSteps_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Url = "https://example.com" },
                new NavigateStep { Url = "https://example.org" },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("nur einen NavigateStep", result.Error);
    }

    [Theory]
    [InlineData("not-a-url")]
    [InlineData("ftp://example.com")]
    [InlineData("")]
    public void Validate_InvalidUrl_Fails(string url)
    {
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Url = url }, new ExtractStep { Name = "Titel", Selector = "h1" }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Ungültige URL", result.Error);
    }

    [Fact]
    public void Validate_NoExtractSteps_Fails()
    {
        var plan = new ScrapingPlan { Steps = [new NavigateStep { Url = "https://example.com" }] };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("ExtractStep", result.Error);
    }

    [Fact]
    public void Validate_EmptyFieldName_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Url = "https://example.com" }, new ExtractStep { Name = "  ", Selector = "h1" }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Feldname", result.Error);
    }

    [Fact]
    public void Validate_EmptySelector_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Url = "https://example.com" }, new ExtractStep { Name = "Titel", Selector = " " }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Selector", result.Error);
    }

    [Fact]
    public void Validate_ValidWaitForStep_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Url = "https://example.com" },
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
            Steps =
            [
                new NavigateStep { Url = "https://example.com" },
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
            Steps =
            [
                new NavigateStep { Url = "https://example.com" },
                new WaitForStep { Selector = ".loaded", TimeoutMs = 0 },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Timeout", result.Error);
    }

    [Fact]
    public void Validate_DuplicateFieldNames_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Url = "https://example.com" },
                new ExtractStep { Name = "Titel", Selector = "h1" },
                new ExtractStep { Name = "Titel", Selector = "h2" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Doppelte Feldnamen", result.Error);
        Assert.Contains("Titel", result.Error);
    }
}
