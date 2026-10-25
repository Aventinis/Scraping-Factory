using ScrapingFactory.Compiler.IR;
using Xunit;
using static ScrapingFactory.Tests.ValidatorTestPlans;

namespace ScrapingFactory.Tests;

// Flat-mode fields: download, transform chains, combine/split and type-conversion transforms. (ScrapingPlanValidator; the plan builders are in ValidatorTestPlans.)
public class ScrapingPlanValidatorFieldTests
{
    [Fact]
    public void Validate_FlatFieldDownloadWithoutAttribute_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ExtractStep { Name = "Link", Selector = "a", Download = true }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("attribute", result.Error);
        Assert.Contains("Link", result.Error);
    }

    [Fact]
    public void Validate_FlatFieldDownloadWithAttribute_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ExtractStep { Name = "Link", Selector = "a", Attribute = "href", Download = true }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Validate_FlatFieldDownloadWithNonPositiveMaxSize_Fails(int maxSize)
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = "Link", Selector = "a", Attribute = "href", Download = true, MaxDownloadSizeBytes = maxSize },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Max download size", result.Error);
    }

    [Fact]
    public void Validate_FlatFieldDownloadWithBlankAllowedContentTypeEntry_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = "Link", Selector = "a", Attribute = "href", Download = true, AllowedContentTypes = ["application/pdf", " "] },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Allowed content type", result.Error);
    }

    [Fact]
    public void Validate_FlatFieldDownloadWithSafetyNet_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep
                {
                    Name = "Link", Selector = "a", Attribute = "href", Download = true,
                    MaxDownloadSizeBytes = 1024, AllowedContentTypes = ["application/pdf", "application/zip"],
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ExtractStepWithValidTransforms_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep
                {
                    Name = "Preis", Selector = ".price",
                    Transforms = [new TrimTransform(), new RegexExtractTransform { Pattern = @"\d+" }, new ToNumberTransform()],
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ExtractStepWithInvalidRegexTransform_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = "Preis", Selector = ".price", Transforms = [new RegexExtractTransform { Pattern = "[unclosed" }] },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Preis", result.Error);
    }

    [Fact]
    public void Validate_ExtractStepWithNegativeTransformGroup_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = "Preis", Selector = ".price", Transforms = [new RegexExtractTransform { Pattern = @"\d+", Group = -1 }] },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
    }

    [Fact]
    public void Validate_CombineFieldsReferencingEarlierFields_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = "Strasse", Selector = ".street" },
                new ExtractStep { Name = "Hausnummer", Selector = ".house-number" },
                new ExtractStep
                {
                    Name = "Adresse", Selector = ".street",
                    Transforms = [new CombineFieldsTransform { SourceFieldNames = ["Strasse", "Hausnummer"] }],
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_SplitFieldReferencingEarlierField_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = "Adresse", Selector = ".address" },
                new ExtractStep
                {
                    Name = "Strasse", Selector = ".address",
                    Transforms = [new SplitFieldTransform { SourceFieldName = "Adresse", Separator = ",", Index = 0 }],
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    // Issue #206 follow-up: the dedicated combine/split creation flow never
    // collects a Selector at all — Selector may be blank precisely (and
    // only) when the field's own Transforms starts with combineFields/
    // splitField.
    [Fact]
    public void Validate_CombineFieldsWithBlankSelector_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = "Strasse", Selector = ".street" },
                new ExtractStep { Name = "Hausnummer", Selector = ".house-number" },
                new ExtractStep
                {
                    Name = "Adresse", Selector = null,
                    Transforms = [new CombineFieldsTransform { SourceFieldNames = ["Strasse", "Hausnummer"] }],
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_BlankSelectorWithoutCombineOrSplitTransform_StillFails()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = "Titel", Selector = null },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Selector", result.Error);
    }

    [Fact]
    public void Validate_DataFieldNodeWithBlankSelectorAndSplitFieldTransform_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractGroupStep
                {
                    Roots =
                    [
                        new GroupNode
                        {
                            Name = "Item", Selector = ".item", Repeating = true,
                            Children =
                            [
                                new DataFieldNode { Name = "Adresse", Selector = ".address" },
                                new DataFieldNode
                                {
                                    Name = "Strasse", Selector = null,
                                    Transforms = [new SplitFieldTransform { SourceFieldName = "Adresse", Separator = ",", Index = 0 }],
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_CombineFieldsReferencingFieldDeclaredLater_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep
                {
                    Name = "Adresse", Selector = ".street",
                    Transforms = [new CombineFieldsTransform { SourceFieldNames = ["Strasse", "Hausnummer"] }],
                },
                new ExtractStep { Name = "Strasse", Selector = ".street" },
                new ExtractStep { Name = "Hausnummer", Selector = ".house-number" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("declared earlier", result.Error);
    }

    [Fact]
    public void Validate_SplitFieldReferencingItself_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep
                {
                    Name = "Adresse", Selector = ".address",
                    Transforms = [new SplitFieldTransform { SourceFieldName = "Adresse" }],
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("cannot reference its own field", result.Error);
    }

    [Fact]
    public void Validate_CombineFieldsReferencingUndeclaredField_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = "Strasse", Selector = ".street" },
                new ExtractStep
                {
                    Name = "Adresse", Selector = ".street",
                    Transforms = [new CombineFieldsTransform { SourceFieldNames = ["Strasse", "NichtVorhanden"] }],
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("NichtVorhanden", result.Error);
    }

    [Fact]
    public void Validate_CombineFieldsWithOnlyOneSourceField_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = "Strasse", Selector = ".street" },
                new ExtractStep
                {
                    Name = "Adresse", Selector = ".street",
                    Transforms = [new CombineFieldsTransform { SourceFieldNames = ["Strasse"] }],
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("at least 2 source fields", result.Error);
    }

    [Fact]
    public void Validate_DataFieldNodeCombineFieldsReferencingSiblingUnderDifferentParentGroup_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractGroupStep
                {
                    Roots =
                    [
                        new GroupNode
                        {
                            Name = "GruppeA", Selector = ".a", Repeating = false,
                            Children = [new DataFieldNode { Name = "Strasse", Selector = ".street" }],
                        },
                        new GroupNode
                        {
                            Name = "GruppeB", Selector = ".b", Repeating = false,
                            Children =
                            [
                                new DataFieldNode
                                {
                                    Name = "Adresse", Selector = ".street",
                                    Transforms = [new SplitFieldTransform { SourceFieldName = "Strasse" }],
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("declared earlier", result.Error);
    }

    [Fact]
    public void Validate_DataFieldNodeCombineFieldsReferencingEarlierSiblingInSameGroup_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractGroupStep
                {
                    Roots =
                    [
                        new GroupNode
                        {
                            Name = "Angebot", Selector = ".offer", Repeating = true,
                            Children =
                            [
                                new DataFieldNode { Name = "Strasse", Selector = ".street" },
                                new DataFieldNode { Name = "Hausnummer", Selector = ".house-number" },
                                new DataFieldNode
                                {
                                    Name = "Adresse", Selector = ".street",
                                    Transforms = [new CombineFieldsTransform { SourceFieldNames = ["Strasse", "Hausnummer"] }],
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ExtractStepWithValidTypeConversionTransforms_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep
                {
                    Name = "Preis", Selector = ".price",
                    Transforms =
                    [
                        new ToIntegerTransform(),
                        new ToBooleanTransform { OnError = TransformErrorMode.UseDefault, DefaultValue = "False" },
                        new ToDateTransform { SourceFormat = "{dd}.{mm}.{yyyy}" },
                    ],
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ExtractStepWithUseDefaultButNoDefaultValue_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = "Preis", Selector = ".price", Transforms = [new ToIntegerTransform { OnError = TransformErrorMode.UseDefault }] },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Preis", result.Error);
    }

    [Fact]
    public void Validate_ExtractStepWithInvalidDateSourceFormat_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = "Datum", Selector = ".date", Transforms = [new ToDateTransform { SourceFormat = "{yyyy}-{mm}" }] }, // missing {dd}
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Datum", result.Error);
    }
}
