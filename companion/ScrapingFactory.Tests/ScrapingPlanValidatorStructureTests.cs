using ScrapingFactory.Compiler.IR;
using Xunit;
using static ScrapingFactory.Tests.ValidatorTestPlans;

namespace ScrapingFactory.Tests;

// Plan structure: navigation URLs, extract steps, flat field names and extraction blocks. (ScrapingPlanValidator; the plan builders are in ValidatorTestPlans.)
public class ScrapingPlanValidatorStructureTests
{
    [Fact]
    public void Validate_ValidPlan_Succeeds()
    {
        var result = ScrapingPlanValidator.Validate(ValidPlan());
        Assert.True(result.Success);
        Assert.Null(result.Error);
    }

    [Fact]
    public void Validate_BlocksWithTwoValidBlocks_Succeeds()
    {
        var plan = BlocksPlan(FlatBlock("a", "a"), FlatBlock("b", "b"));

        var result = ScrapingPlanValidator.Validate(plan);

        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_BlocksWithFewerThanTwoBlocks_Fails()
    {
        var plan = BlocksPlan(FlatBlock("a", "a"));

        var result = ScrapingPlanValidator.Validate(plan);

        Assert.False(result.Success);
        Assert.Contains("at least 2", result.Error);
    }

    [Fact]
    public void Validate_BlocksWithDuplicateNames_Fails()
    {
        var plan = BlocksPlan(FlatBlock("dup", "a"), FlatBlock("dup", "b"));

        var result = ScrapingPlanValidator.Validate(plan);

        Assert.False(result.Success);
        Assert.Contains("Duplicate block names", result.Error);
    }

    [Fact]
    public void Validate_BlocksWithDuplicateOutputFileBaseNames_Fails()
    {
        var plan = BlocksPlan(FlatBlock("a", "same"), FlatBlock("b", "same"));

        var result = ScrapingPlanValidator.Validate(plan);

        Assert.False(result.Success);
        Assert.Contains("duplicate output file names", result.Error);
    }

    [Fact]
    public void Validate_BlockWithNeitherFieldsNorGroups_Fails()
    {
        var emptyBlock = new PlanExtractionBlock { Name = "empty", OutputFileBaseName = "empty", OutputFormat = OutputFormat.Csv };
        var plan = BlocksPlan(emptyBlock, FlatBlock("b", "b"));

        var result = ScrapingPlanValidator.Validate(plan);

        Assert.False(result.Success);
        Assert.Contains("at least one field or group", result.Error);
    }

    [Fact]
    public void Validate_BlockWithGroupsReusesContainerNodeValidation()
    {
        var groupBlock = new PlanExtractionBlock
        {
            Name = "grp", OutputFileBaseName = "grp", OutputFormat = OutputFormat.Xml,
            Groups = [new GroupNode { Name = "Item", Selector = "", Repeating = true, Children = [] }],
        };
        var plan = BlocksPlan(groupBlock, FlatBlock("b", "b"));

        var result = ScrapingPlanValidator.Validate(plan);

        Assert.False(result.Success);
        Assert.Contains("Selector of group", result.Error);
    }

    [Fact]
    public void Validate_BlockWithInvalidPerBlockHardening_Fails()
    {
        var block = new PlanExtractionBlock
        {
            Name = "a", OutputFileBaseName = "a", OutputFormat = OutputFormat.Csv,
            Fields = [new ExtractStep { Name = "Titel", Selector = "h1" }],
            Hardening = [new NullRateCheck { Severity = HardeningSeverity.Warning, FieldName = "Titel", Threshold = 1.5 }],
        };
        var plan = BlocksPlan(block, FlatBlock("b", "b"));

        var result = ScrapingPlanValidator.Validate(plan);

        Assert.False(result.Success);
        Assert.Contains("'a'", result.Error);
        Assert.Contains("threshold must be between 0 and 1", result.Error);
    }

    [Fact]
    public void Validate_BlockWithInvalidPerBlockChangeDetection_Fails()
    {
        var block = new PlanExtractionBlock
        {
            Name = "a", OutputFileBaseName = "a", OutputFormat = OutputFormat.Csv,
            Fields = [new ExtractStep { Name = "Titel", Selector = "h1" }],
            ChangeDetection = new ChangeDetectionConfig { Notify = "Webhook", Webhook = new WebhookNotificationConfig { UrlEnvVar = "not valid" } },
        };
        var plan = BlocksPlan(block, FlatBlock("b", "b"));

        var result = ScrapingPlanValidator.Validate(plan);

        Assert.False(result.Success);
        Assert.Contains("'a'", result.Error);
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
                new NavigateStep { Urls = ["https://example.com"] },
                new NavigateStep { Urls = ["https://example.org"] },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("more than one NavigateStep", result.Error);
    }

    [Theory]
    [InlineData("not-a-url")]
    [InlineData("ftp://example.com")]
    [InlineData("")]
    public void Validate_InvalidUrl_Fails(string url)
    {
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [url] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Invalid start URL", result.Error);
    }

    // Issue #83
    [Fact]
    public void Validate_MultipleValidUrls_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com/a", "https://example.com/b"] },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success);
        Assert.Null(result.Error);
    }

    [Fact]
    public void Validate_SecondUrlInvalid_FailsWithItsIndex()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com/a", "not-a-url"] },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("start URL #2", result.Error);
    }

    [Fact]
    public void Validate_EmptyUrls_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("at least one URL", result.Error);
    }

    [Fact]
    public void Validate_NoExtractSteps_Fails()
    {
        var plan = new ScrapingPlan { Steps = [new NavigateStep { Urls = ["https://example.com"] }] };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("ExtractStep", result.Error);
    }

    [Fact]
    public void Validate_EmptyFieldName_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ExtractStep { Name = "  ", Selector = "h1" }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Field name", result.Error);
    }

    [Fact]
    public void Validate_EmptySelector_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ExtractStep { Name = "Titel", Selector = " " }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Selector", result.Error);
    }
}
