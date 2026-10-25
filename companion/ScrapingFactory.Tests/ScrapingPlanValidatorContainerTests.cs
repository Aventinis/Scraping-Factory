using ScrapingFactory.Compiler.IR;
using Xunit;
using static ScrapingFactory.Tests.ValidatorTestPlans;

namespace ScrapingFactory.Tests;

// Container mode (ExtractGroupStep): group trees, downloads and frame paths. (ScrapingPlanValidator; the plan builders are in ValidatorTestPlans.)
public class ScrapingPlanValidatorContainerTests
{
    [Fact]
    public void Validate_ValidNestedGroupTree_Succeeds()
    {
        var roots = new List<GroupNode>
        {
            new()
            {
                Name = "Kategorie",
                Selector = "section.menu-category",
                Repeating = true,
                Children =
                [
                    new DataFieldNode { Name = "Titel", Selector = "h2" },
                    new GroupNode
                    {
                        Name = "Gericht",
                        Selector = "li.menu-item",
                        Repeating = true,
                        Children =
                        [
                            new DataFieldNode { Name = "Name", Selector = "h3" },
                            new DataFieldNode { Name = "Link", Selector = "a", Mode = ExtractMode.Attribute, Attribute = "href" },
                            new DataFieldNode { Name = "Vegan", Selector = ".vegan", Mode = ExtractMode.Exists },
                        ],
                    },
                ],
            },
        };

        var result = ScrapingPlanValidator.Validate(GroupPlan(roots));

        Assert.True(result.Success);
        Assert.Null(result.Error);
    }

    // Container-Mode works identically regardless of engine — unlike
    // WaitFor/Fill/Click it's not in browserOnlySteps.
    [Fact]
    public void Validate_GroupPlanWithStaticEngine_Succeeds()
    {
        var roots = new List<GroupNode>
        {
            new() { Name = "Kategorie", Selector = "section", Repeating = true, Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }] },
        };

        var result = ScrapingPlanValidator.Validate(GroupPlan(roots, ScrapingEngine.Static));

        Assert.True(result.Success);
    }

    [Fact]
    public void Validate_EmptyRoots_Fails()
    {
        var result = ScrapingPlanValidator.Validate(GroupPlan([]));
        Assert.False(result.Success);
        Assert.Contains("ExtractGroupStep", result.Error);
    }

    [Fact]
    public void Validate_GroupWithEmptyName_Fails()
    {
        var roots = new List<GroupNode> { new() { Name = " ", Selector = "section", Repeating = true, Children = [] } };
        var result = ScrapingPlanValidator.Validate(GroupPlan(roots));
        Assert.False(result.Success);
        Assert.Contains("Name", result.Error);
    }

    [Fact]
    public void Validate_GroupWithEmptySelector_Fails()
    {
        var roots = new List<GroupNode> { new() { Name = "Kategorie", Selector = " ", Repeating = true, Children = [] } };
        var result = ScrapingPlanValidator.Validate(GroupPlan(roots));
        Assert.False(result.Success);
        Assert.Contains("Selector", result.Error);
        Assert.Contains("Kategorie", result.Error);
    }

    [Fact]
    public void Validate_NestedDataFieldWithEmptySelector_Fails()
    {
        var roots = new List<GroupNode>
        {
            new()
            {
                Name = "Kategorie", Selector = "section", Repeating = true,
                Children = [new DataFieldNode { Name = "Titel", Selector = " " }],
            },
        };
        var result = ScrapingPlanValidator.Validate(GroupPlan(roots));
        Assert.False(result.Success);
        Assert.Contains("Selector", result.Error);
        Assert.Contains("Titel", result.Error);
    }

    [Fact]
    public void Validate_DataFieldAttributeModeWithoutAttribute_Fails()
    {
        var roots = new List<GroupNode>
        {
            new()
            {
                Name = "Kategorie", Selector = "section", Repeating = true,
                Children = [new DataFieldNode { Name = "Link", Selector = "a", Mode = ExtractMode.Attribute }],
            },
        };
        var result = ScrapingPlanValidator.Validate(GroupPlan(roots));
        Assert.False(result.Success);
        Assert.Contains("attribute", result.Error);
        Assert.Contains("Link", result.Error);
    }

    [Fact]
    public void Validate_ContainerFieldDownloadWithNonPositiveMaxSize_Fails()
    {
        var roots = new List<GroupNode>
        {
            new()
            {
                Name = "Kategorie", Selector = "section", Repeating = true,
                Children = [new DataFieldNode { Name = "Link", Selector = "a", Mode = ExtractMode.Attribute, Attribute = "href", Download = true, MaxDownloadSizeBytes = 0 }],
            },
        };
        var result = ScrapingPlanValidator.Validate(GroupPlan(roots));
        Assert.False(result.Success);
        Assert.Contains("Max download size", result.Error);
    }

    [Fact]
    public void Validate_ContainerFieldDownloadWithBlankAllowedContentTypeEntry_Fails()
    {
        var roots = new List<GroupNode>
        {
            new()
            {
                Name = "Kategorie", Selector = "section", Repeating = true,
                Children = [new DataFieldNode { Name = "Link", Selector = "a", Mode = ExtractMode.Attribute, Attribute = "href", Download = true, AllowedContentTypes = [""] }],
            },
        };
        var result = ScrapingPlanValidator.Validate(GroupPlan(roots));
        Assert.False(result.Success);
        Assert.Contains("Allowed content type", result.Error);
    }

    [Fact]
    public void Validate_ContainerFieldDownloadWithSafetyNet_Succeeds()
    {
        var roots = new List<GroupNode>
        {
            new()
            {
                Name = "Kategorie", Selector = "section", Repeating = true,
                Children =
                [
                    new DataFieldNode
                    {
                        Name = "Link", Selector = "a", Mode = ExtractMode.Attribute, Attribute = "href", Download = true,
                        MaxDownloadSizeBytes = 2048, AllowedContentTypes = ["application/pdf"],
                    },
                ],
            },
        };
        var result = ScrapingPlanValidator.Validate(GroupPlan(roots));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ValidFramedDataFieldNode_Succeeds()
    {
        var roots = new List<GroupNode>
        {
            new()
            {
                Name = "Kategorie", Selector = "section", Repeating = true,
                Children = [new DataFieldNode { Name = "Preis", Selector = ".price", FramePath = ["iframe#widget"] }],
            },
        };
        var result = ScrapingPlanValidator.Validate(GroupPlan(roots, ScrapingEngine.Browser));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ValidFramedGroupNode_Succeeds()
    {
        var roots = new List<GroupNode>
        {
            new()
            {
                Name = "Kategorie", Selector = "section", Repeating = true, FramePath = ["iframe#widget"],
                Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }],
            },
        };
        var result = ScrapingPlanValidator.Validate(GroupPlan(roots, ScrapingEngine.Browser));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_FramedDataFieldNodeWithStaticEngine_Fails()
    {
        var roots = new List<GroupNode>
        {
            new()
            {
                Name = "Kategorie", Selector = "section", Repeating = true,
                Children = [new DataFieldNode { Name = "Preis", Selector = ".price", FramePath = ["iframe#widget"] }],
            },
        };
        var result = ScrapingPlanValidator.Validate(GroupPlan(roots, ScrapingEngine.Static));
        Assert.False(result.Success);
        Assert.Contains("Engine", result.Error);
        Assert.Contains("Preis", result.Error);
    }

    [Fact]
    public void Validate_FramedGroupNodeWithStaticEngine_Fails()
    {
        var roots = new List<GroupNode>
        {
            new()
            {
                Name = "Kategorie", Selector = "section", Repeating = true, FramePath = ["iframe#widget"],
                Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }],
            },
        };
        var result = ScrapingPlanValidator.Validate(GroupPlan(roots, ScrapingEngine.Static));
        Assert.False(result.Success);
        Assert.Contains("Engine", result.Error);
        Assert.Contains("Kategorie", result.Error);
    }

    [Fact]
    public void Validate_EmptyFramePathOnDataFieldNode_Fails()
    {
        var roots = new List<GroupNode>
        {
            new()
            {
                Name = "Kategorie", Selector = "section", Repeating = true,
                Children = [new DataFieldNode { Name = "Preis", Selector = ".price", FramePath = [] }],
            },
        };
        var result = ScrapingPlanValidator.Validate(GroupPlan(roots, ScrapingEngine.Browser));
        Assert.False(result.Success);
        Assert.Contains("FramePath", result.Error);
    }

    [Fact]
    public void Validate_FramePathWithBlankSegmentOnGroupNode_Fails()
    {
        var roots = new List<GroupNode>
        {
            new()
            {
                Name = "Kategorie", Selector = "section", Repeating = true, FramePath = ["iframe#widget", " "],
                Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }],
            },
        };
        var result = ScrapingPlanValidator.Validate(GroupPlan(roots, ScrapingEngine.Browser));
        Assert.False(result.Success);
        Assert.Contains("FramePath", result.Error);
    }

    [Fact]
    public void Validate_DataFieldNodeWithInvalidRegexTransform_Fails()
    {
        var roots = new List<GroupNode>
        {
            new()
            {
                Name = "Kategorie", Selector = "section", Repeating = true,
                Children = [new DataFieldNode { Name = "Preis", Selector = ".price", Transforms = [new RegexExtractTransform { Pattern = "(" }] }],
            },
        };
        var result = ScrapingPlanValidator.Validate(GroupPlan(roots, ScrapingEngine.Static));
        Assert.False(result.Success);
        Assert.Contains("Preis", result.Error);
    }

    [Fact]
    public void Validate_DataFieldNodeWithValidTransforms_Succeeds()
    {
        var roots = new List<GroupNode>
        {
            new()
            {
                Name = "Kategorie", Selector = "section", Repeating = true,
                Children = [new DataFieldNode { Name = "Preis", Selector = ".price", Transforms = [new ToNumberTransform()] }],
            },
        };
        var result = ScrapingPlanValidator.Validate(GroupPlan(roots, ScrapingEngine.Static));
        Assert.True(result.Success, result.Error);
    }
}
