using ScrapingFactory.Compiler.IR;
using Xunit;
using static ScrapingFactory.Tests.ValidatorTestPlans;

namespace ScrapingFactory.Tests;

// Hardening checks. (ScrapingPlanValidator; the plan builders are in ValidatorTestPlans.)
public class ScrapingPlanValidatorHardeningTests
{
    // Issue #129
    [Fact]
    public void Validate_ValidHardening_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening = [new NoResultCheck { Severity = HardeningSeverity.Error }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_DuplicateHardeningCheckKind_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening =
            [
                new NoResultCheck { Severity = HardeningSeverity.Warning },
                new NoResultCheck { Severity = HardeningSeverity.Error },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("NoResultCheck", result.Error);
        Assert.Contains("configured more than once", result.Error);
    }

    [Fact]
    public void Validate_NoHardening_Succeeds()
    {
        var result = ScrapingPlanValidator.Validate(ValidPlan());
        Assert.True(result.Success, result.Error);
    }

    // Issue #130: unlike NoResultCheck, more than one NullRateCheck is
    // expected — one per monitored field — so this must succeed rather than
    // tripping the "duplicate kind" rule.
    [Fact]
    public void Validate_MultipleDistinctNullRateChecks_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening =
            [
                new NullRateCheck { Severity = HardeningSeverity.Warning, FieldName = "Preis", Threshold = 0.3 },
                new NullRateCheck { Severity = HardeningSeverity.Error, FieldName = "Titel", Threshold = 0.1 },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_NullRateAndNoResultTogether_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening =
            [
                new NoResultCheck { Severity = HardeningSeverity.Error },
                new NullRateCheck { Severity = HardeningSeverity.Warning, FieldName = "Preis", Threshold = 0.3 },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_DuplicateNullRateFieldName_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening =
            [
                new NullRateCheck { Severity = HardeningSeverity.Warning, FieldName = "Preis", Threshold = 0.3 },
                new NullRateCheck { Severity = HardeningSeverity.Error, FieldName = "Preis", Threshold = 0.5 },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("NullRate", result.Error);
        Assert.Contains("Preis", result.Error);
        Assert.Contains("configured more than once", result.Error);
    }

    [Fact]
    public void Validate_NullRateBlankFieldName_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening = [new NullRateCheck { Severity = HardeningSeverity.Warning, FieldName = "  ", Threshold = 0.3 }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("needs a field name", result.Error);
    }

    [Theory]
    [InlineData(-0.1)]
    [InlineData(1.1)]
    public void Validate_NullRateThresholdOutOfRange_Fails(double threshold)
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening = [new NullRateCheck { Severity = HardeningSeverity.Warning, FieldName = "Preis", Threshold = threshold }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("threshold must be between", result.Error);
    }

    // Issue #131
    [Fact]
    public void Validate_ValidBaselineCheck_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening = [new BaselineCheck { Severity = HardeningSeverity.Error, DropThreshold = 0.2 }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_DuplicateBaselineCheck_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening =
            [
                new BaselineCheck { Severity = HardeningSeverity.Warning, DropThreshold = 0.2 },
                new BaselineCheck { Severity = HardeningSeverity.Error, DropThreshold = 0.3 },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("BaselineCheck", result.Error);
        Assert.Contains("configured more than once", result.Error);
    }

    [Theory]
    [InlineData(-0.1)]
    [InlineData(1.1)]
    public void Validate_BaselineDropThresholdOutOfRange_Fails(double threshold)
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening = [new BaselineCheck { Severity = HardeningSeverity.Warning, DropThreshold = threshold }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("threshold must be between", result.Error);
    }

    [Fact]
    public void Validate_BaselineAndNullRateAndNoResultTogether_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening =
            [
                new NoResultCheck { Severity = HardeningSeverity.Error },
                new NullRateCheck { Severity = HardeningSeverity.Warning, FieldName = "Preis", Threshold = 0.3 },
                new BaselineCheck { Severity = HardeningSeverity.Warning, DropThreshold = 0.2 },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    // Issue #132
    [Fact]
    public void Validate_ValidBlockingCheck_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening = [new BlockingCheck { Severity = HardeningSeverity.Error, MinBodyLength = 200, BlockPhrases = ["Access Denied"] }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    // Unlike NullRate, there's no "at least one signal configured"
    // requirement — the cross-origin-redirect signal is always active, so a
    // BlockingCheck with neither MinBodyLength nor BlockPhrases set is still
    // a meaningful, valid configuration.
    [Fact]
    public void Validate_BlockingCheckWithNoOptionalFieldsSet_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening = [new BlockingCheck { Severity = HardeningSeverity.Warning }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_DuplicateBlockingCheck_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening =
            [
                new BlockingCheck { Severity = HardeningSeverity.Warning },
                new BlockingCheck { Severity = HardeningSeverity.Error },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("BlockingCheck", result.Error);
        Assert.Contains("configured more than once", result.Error);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public void Validate_BlockingCheckWithNonPositiveMinBodyLength_Fails(int minBodyLength)
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening = [new BlockingCheck { Severity = HardeningSeverity.Warning, MinBodyLength = minBodyLength }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("MinBodyLength must be positive", result.Error);
    }

    [Fact]
    public void Validate_BlockingCheckWithBlankBlockPhrase_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening = [new BlockingCheck { Severity = HardeningSeverity.Warning, BlockPhrases = ["Access Denied", "  "] }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("block phrases must not be blank", result.Error);
    }

    [Fact]
    public void Validate_AllFourHardeningChecksTogether_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening =
            [
                new NoResultCheck { Severity = HardeningSeverity.Error },
                new NullRateCheck { Severity = HardeningSeverity.Warning, FieldName = "Preis", Threshold = 0.3 },
                new BaselineCheck { Severity = HardeningSeverity.Warning, DropThreshold = 0.2 },
                new BlockingCheck { Severity = HardeningSeverity.Error, MinBodyLength = 200, BlockPhrases = ["Access Denied"] },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    // Issue #133
    [Fact]
    public void Validate_ValidRequiredFieldsCheck_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening = [new RequiredFieldsCheck { Severity = HardeningSeverity.Error, FieldNames = ["Titel"] }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_DuplicateRequiredFieldsCheck_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening =
            [
                new RequiredFieldsCheck { Severity = HardeningSeverity.Warning, FieldNames = ["Titel"] },
                new RequiredFieldsCheck { Severity = HardeningSeverity.Error, FieldNames = ["Preis"] },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("RequiredFieldsCheck", result.Error);
        Assert.Contains("configured more than once", result.Error);
    }

    [Fact]
    public void Validate_RequiredFieldsCheckWithEmptyFieldNames_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening = [new RequiredFieldsCheck { Severity = HardeningSeverity.Warning, FieldNames = [] }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("needs at least one field name", result.Error);
    }

    [Fact]
    public void Validate_RequiredFieldsCheckWithBlankFieldName_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening = [new RequiredFieldsCheck { Severity = HardeningSeverity.Warning, FieldNames = ["Titel", "  "] }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("field names must not be blank", result.Error);
    }

    [Fact]
    public void Validate_RequiredFieldsCheckWithDuplicateFieldName_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening = [new RequiredFieldsCheck { Severity = HardeningSeverity.Warning, FieldNames = ["Titel", "Titel"] }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("duplicate field name 'Titel'", result.Error);
    }

    // Follow-up: container mode supports RequiredFieldsCheck (matched
    // globally by tag name, dropping the nearest enclosing repeating
    // instance — see RequiredFieldsCheck's own doc comment).
    [Fact]
    public void Validate_RequiredFieldsCheckWithContainerMode_Succeeds()
    {
        var roots = new List<GroupNode>
        {
            new() { Name = "Kategorie", Selector = "section", Repeating = true, Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }] },
        };
        var plan = new ScrapingPlan
        {
            Steps = GroupPlan(roots).Steps,
            Hardening = [new RequiredFieldsCheck { Severity = HardeningSeverity.Warning, FieldNames = ["Titel"] }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    // Api-mode's flat shape has just as unambiguous a "row" as flat Fields
    // mode, so it's allowed there.
    [Fact]
    public void Validate_RequiredFieldsCheckWithApiFlatShape_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ApiPlan(ValidApiConfig()).Steps,
            Engine = ScrapingEngine.Api,
            Hardening = [new RequiredFieldsCheck { Severity = HardeningSeverity.Warning, FieldNames = ["Titel"] }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    // Issue #204: Api-mode's tree shape (Groups) is no longer rejected
    // either — the same "nearest enclosing repeating group instance"
    // mechanism container mode already established now applies to
    // ApiGroup/ApiField too (see _extract_api_group's own doc comment in
    // scraper_api_grouped.py.j2).
    [Fact]
    public void Validate_RequiredFieldsCheckWithApiTreeShape_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ApiPlan(ValidApiGroupsConfig()).Steps,
            Engine = ScrapingEngine.Api,
            Hardening = [new RequiredFieldsCheck { Severity = HardeningSeverity.Warning, FieldNames = ["Titel"] }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_AllFiveHardeningChecksTogether_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Hardening =
            [
                new NoResultCheck { Severity = HardeningSeverity.Error },
                new NullRateCheck { Severity = HardeningSeverity.Warning, FieldName = "Preis", Threshold = 0.3 },
                new BaselineCheck { Severity = HardeningSeverity.Warning, DropThreshold = 0.2 },
                new BlockingCheck { Severity = HardeningSeverity.Error, MinBodyLength = 200, BlockPhrases = ["Access Denied"] },
                new RequiredFieldsCheck { Severity = HardeningSeverity.Error, FieldNames = ["Titel"] },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    // ---- Issue #225: deduplication ---------------------------------------
}
