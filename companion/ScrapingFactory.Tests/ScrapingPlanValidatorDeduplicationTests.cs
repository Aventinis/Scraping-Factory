using ScrapingFactory.Compiler.IR;
using Xunit;
using static ScrapingFactory.Tests.ValidatorTestPlans;

namespace ScrapingFactory.Tests;

// Deduplication. (ScrapingPlanValidator; the plan builders are in ValidatorTestPlans.)
public class ScrapingPlanValidatorDeduplicationTests
{
    [Fact]
    public void Validate_Deduplication_ValidFlatCompositeKey_Succeeds()
    {
        var result = ScrapingPlanValidator.Validate(DedupFlatPlan(new DeduplicationConfig { KeyFields = ["Titel", "Preis"], Incremental = true }));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_Deduplication_NoKeyFields_Fails()
    {
        var result = ScrapingPlanValidator.Validate(DedupFlatPlan(new DeduplicationConfig()));
        Assert.False(result.Success);
        Assert.Contains("at least one key field", result.Error);
    }

    [Fact]
    public void Validate_Deduplication_BlankDuplicateOrUnknownKeyField_Fails()
    {
        Assert.Contains("blank", ScrapingPlanValidator.Validate(DedupFlatPlan(new DeduplicationConfig { KeyFields = ["Titel", " "] })).Error);
        Assert.Contains("duplicate key field 'Titel'", ScrapingPlanValidator.Validate(DedupFlatPlan(new DeduplicationConfig { KeyFields = ["Titel", "Titel"] })).Error);
        Assert.Contains("'Nope' does not match", ScrapingPlanValidator.Validate(DedupFlatPlan(new DeduplicationConfig { KeyFields = ["Nope"] })).Error);
    }

    [Fact]
    public void Validate_Deduplication_NonPositiveRetention_Fails()
    {
        var dedup = new DeduplicationConfig { KeyFields = ["Titel"], Incremental = true, Retention = new DeduplicationRetention { Value = 0 } };
        var result = ScrapingPlanValidator.Validate(DedupFlatPlan(dedup));
        Assert.False(result.Success);
        Assert.Contains("retention", result.Error);
    }

    [Fact]
    public void Validate_Deduplication_AppendOnFlatShape_Succeeds()
    {
        var dedup = new DeduplicationConfig { KeyFields = ["Titel"], Incremental = true, IncrementalOutput = IncrementalOutputMode.Append };
        Assert.True(ScrapingPlanValidator.Validate(DedupFlatPlan(dedup)).Success);
    }

    [Fact]
    public void Validate_Deduplication_AppendOnTreeShape_Succeeds()
    {
        // Issue #342: appending works for every output format, trees included.
        var dedup = new DeduplicationConfig { KeyFields = ["Name"], Incremental = true, IncrementalOutput = IncrementalOutputMode.Append };
        Assert.True(ScrapingPlanValidator.Validate(DedupGroupPlan(dedup)).Success);
    }

    [Fact]
    public void Validate_Deduplication_ContainerKeyMustBeALeafField()
    {
        Assert.True(ScrapingPlanValidator.Validate(DedupGroupPlan(new DeduplicationConfig { KeyFields = ["Name"] })).Success);
        // a group's own name is not a field
        Assert.False(ScrapingPlanValidator.Validate(DedupGroupPlan(new DeduplicationConfig { KeyFields = ["Gericht"] })).Success);
    }

    [Fact]
    public void Validate_Deduplication_TreeShapeWithOutputBlueprint_Fails()
    {
        var blueprint = new OutputBlueprintMapping
        {
            SchemaKind = OutputBlueprintSchemaKind.Flat,
            Fields = [new OutputBlueprintFieldMapping { TargetField = "T", SourceField = "Name" }],
        };
        var result = ScrapingPlanValidator.Validate(DedupGroupPlan(new DeduplicationConfig { KeyFields = ["Name"] }, blueprint));
        Assert.False(result.Success);
        Assert.Contains("Output Blueprint", result.Error);
    }

    [Fact]
    public void Validate_Deduplication_FlatShapeWithOutputBlueprint_Succeeds()
    {
        var blueprint = new OutputBlueprintMapping
        {
            SchemaKind = OutputBlueprintSchemaKind.Flat,
            Fields = [new OutputBlueprintFieldMapping { TargetField = "T", SourceField = "Titel" }],
        };
        var result = ScrapingPlanValidator.Validate(DedupFlatPlan(new DeduplicationConfig { KeyFields = ["Titel"] }, blueprint));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_Deduplication_ApiFlat_ParameterNameIsAValidKeyField()
    {
        var api = new ApiConfig
        {
            UrlTemplate = "https://example.com/items/{week}",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Id", Path = "id" }],
            Parameters = [new ApiParameter { Name = "week", Source = new StaticListSource { Values = ["1", "2"] } }],
        };
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
            Engine = ScrapingEngine.Api,
            Deduplication = new DeduplicationConfig { KeyFields = ["week", "Id"] },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    // ---- Issue #226: custom request headers --------------------------------
}
