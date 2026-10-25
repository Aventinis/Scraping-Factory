using ScrapingFactory.Compiler.IR;
using Xunit;
using static ScrapingFactory.Tests.ValidatorTestPlans;

namespace ScrapingFactory.Tests;

// Output Blueprint field mapping. (ScrapingPlanValidator; the plan builders are in ValidatorTestPlans.)
public class ScrapingPlanValidatorBlueprintTests
{
    [Fact]
    public void Validate_FlatPlanWithValidBlueprintMapping_Succeeds()
    {
        var blueprint = new OutputBlueprintMapping
        {
            Fields =
            [
                new OutputBlueprintFieldMapping { TargetField = "name", SourceField = "Titel" },
                new OutputBlueprintFieldMapping { TargetField = "cost", SourceField = "Preis" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(FlatPlanWithBlueprint(blueprint));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_BlueprintMapping_UnmappedSourceFieldIsAllowed()
    {
        // Only "Titel" is mapped — "Preis" is simply omitted from the
        // output, not an error (see OutputBlueprintMapping's own doc
        // comment).
        var blueprint = new OutputBlueprintMapping
        {
            Fields = [new OutputBlueprintFieldMapping { TargetField = "name", SourceField = "Titel" }],
        };
        var result = ScrapingPlanValidator.Validate(FlatPlanWithBlueprint(blueprint));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_BlueprintMapping_EmptyFieldList_Fails()
    {
        var blueprint = new OutputBlueprintMapping { Fields = [] };
        var result = ScrapingPlanValidator.Validate(FlatPlanWithBlueprint(blueprint));
        Assert.False(result.Success);
        Assert.Contains("OutputBlueprint", result.Error);
    }

    [Fact]
    public void Validate_BlueprintMapping_UnknownSourceField_Fails()
    {
        var blueprint = new OutputBlueprintMapping
        {
            Fields = [new OutputBlueprintFieldMapping { TargetField = "name", SourceField = "DoesNotExist" }],
        };
        var result = ScrapingPlanValidator.Validate(FlatPlanWithBlueprint(blueprint));
        Assert.False(result.Success);
        Assert.Contains("DoesNotExist", result.Error);
    }

    [Fact]
    public void Validate_BlueprintMapping_DuplicateTargetField_Fails()
    {
        var blueprint = new OutputBlueprintMapping
        {
            Fields =
            [
                new OutputBlueprintFieldMapping { TargetField = "name", SourceField = "Titel" },
                new OutputBlueprintFieldMapping { TargetField = "name", SourceField = "Preis" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(FlatPlanWithBlueprint(blueprint));
        Assert.False(result.Success);
        Assert.Contains("target field", result.Error);
    }

    [Fact]
    public void Validate_BlueprintMapping_DuplicateSourceField_Fails()
    {
        var blueprint = new OutputBlueprintMapping
        {
            Fields =
            [
                new OutputBlueprintFieldMapping { TargetField = "name", SourceField = "Titel" },
                new OutputBlueprintFieldMapping { TargetField = "title2", SourceField = "Titel" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(FlatPlanWithBlueprint(blueprint));
        Assert.False(result.Success);
        Assert.Contains("source field", result.Error);
    }

    [Fact]
    public void Validate_BlueprintMapping_BlankTargetField_Fails()
    {
        var blueprint = new OutputBlueprintMapping
        {
            Fields = [new OutputBlueprintFieldMapping { TargetField = " ", SourceField = "Titel" }],
        };
        var result = ScrapingPlanValidator.Validate(FlatPlanWithBlueprint(blueprint));
        Assert.False(result.Success);
    }

    [Fact]
    public void Validate_ApiFlatPlanWithValidBlueprintMapping_Succeeds()
    {
        var api = ValidApiConfig();
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Api,
            Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
            OutputBlueprint = new OutputBlueprintMapping
            {
                Fields = [new OutputBlueprintFieldMapping { TargetField = "name", SourceField = "Titel" }],
            },
        };

        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ApiFlatPlanWithBlueprintMappingReferencingParameter_Fails()
    {
        // Api parameters aren't mappable as blueprint source fields — the
        // same simplification NullRateCheck/RequiredFieldsCheck's own field
        // pickers already make for Api mode.
        var api = ValidApiConfig();
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Api,
            Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
            OutputBlueprint = new OutputBlueprintMapping
            {
                Fields = [new OutputBlueprintFieldMapping { TargetField = "cat", SourceField = "category" }],
            },
        };

        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("category", result.Error);
    }
}
