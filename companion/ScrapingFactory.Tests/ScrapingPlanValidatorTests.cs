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
            Engine = ScrapingEngine.Browser,
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
            Engine = ScrapingEngine.Browser,
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
            Engine = ScrapingEngine.Browser,
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
    public void Validate_BrowserOnlyStepWithStaticEngine_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Static,
            Steps =
            [
                new NavigateStep { Url = "https://example.com" },
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
                new NavigateStep { Url = "https://example.com/login" },
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
                new NavigateStep { Url = "https://example.com" },
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
                new NavigateStep { Url = "https://example.com" },
                new FillStep { Selector = "#user", EnvironmentVariableName = envVarName },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Umgebungsvariablen-Name", result.Error);
    }

    [Fact]
    public void Validate_ClickStepWithEmptySelector_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Url = "https://example.com" },
                new ClickStep { Selector = " " },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("ClickStep", result.Error);
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

    // ── Container-Mode (ExtractGroupStep) ────────────────────────────────

    private static ScrapingPlan GroupPlan(List<GroupNode> roots, ScrapingEngine engine = ScrapingEngine.Static) => new()
    {
        Engine = engine,
        Steps = [new NavigateStep { Url = "https://example.com" }, new ExtractGroupStep { Roots = roots }],
    };

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
        Assert.Contains("Attribut", result.Error);
        Assert.Contains("Link", result.Error);
    }
}
