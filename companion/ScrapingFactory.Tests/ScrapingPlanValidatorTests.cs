using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class ScrapingPlanValidatorTests
{
    private static ScrapingPlan ValidPlan() => new()
    {
        Steps =
        [
            new NavigateStep { Urls = ["https://example.com"] },
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

    // ── Issue #84: field transform chains ────────────────────────────────

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

    // ── ScrollStep ───────────────────────────────────────────────────────

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

    // ── FramePath for Action Steps (Issue #42, Phase 4) ─────────────────────

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

    // ── FramePath (Issue #42) ───────────────────────────────────────────────

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

    // ── Container-Mode (ExtractGroupStep) ────────────────────────────────

    private static ScrapingPlan GroupPlan(List<GroupNode> roots, ScrapingEngine engine = ScrapingEngine.Static) => new()
    {
        Engine = engine,
        Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ExtractGroupStep { Roots = roots }],
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
        Assert.Contains("attribute", result.Error);
        Assert.Contains("Link", result.Error);
    }

    // ── Container-Mode FramePath (Issue #42, Phase 3) ───────────────────────

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

    // ── API-Mode (ApiCallStep) ────────────────────────────────────────────

    private static ApiConfig ValidApiConfig() => new()
    {
        UrlTemplate = "https://example.com/api/items?category={category}",
        ItemsPath = "data.items",
        Fields = [new ApiField { Name = "Titel", Path = "title" }],
        Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
    };

    private static ScrapingPlan ApiPlan(ApiConfig api) => new()
    {
        Engine = ScrapingEngine.Api,
        Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
    };

    [Fact]
    public void Validate_ValidApiConfig_Succeeds()
    {
        var result = ScrapingPlanValidator.Validate(ApiPlan(ValidApiConfig()));
        Assert.True(result.Success);
        Assert.Null(result.Error);
    }

    [Theory]
    [InlineData("PUT")]
    [InlineData("DELETE")]
    [InlineData("get")]
    [InlineData("")]
    public void Validate_ApiConfigWithUnsupportedMethod_Fails(string method)
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            Method = method, UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath,
            Fields = api.Fields, Parameters = api.Parameters,
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("GET", result.Error);
    }

    // POST (Issue #55) is now a supported method, unlike PUT/DELETE/etc.
    // above — a bodyless POST (no ApiConfig.Body set) is still a fully
    // valid config, exactly like the existing GET-based ValidApiConfig().
    [Fact]
    public void Validate_ApiConfigWithPostMethodAndNoBody_Succeeds()
    {
        var api = ValidApiConfig();
        var valid = new ApiConfig
        {
            Method = "POST", UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath,
            Fields = api.Fields, Parameters = api.Parameters,
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithEmptyItemsPath_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate, ItemsPath = " ", Fields = api.Fields, Parameters = api.Parameters,
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("ItemsPath", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithNoFields_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath, Fields = [], Parameters = api.Parameters,
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("field", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithDuplicateFieldNames_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items",
            ItemsPath = api.ItemsPath,
            Fields = [new ApiField { Name = "Titel", Path = "title" }, new ApiField { Name = "Titel", Path = "name" }],
            Parameters = api.Parameters,
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Duplicate field names", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithFieldNameCollidingWithParameterName_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?category={category}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "category", Path = "categorySlug" }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("collide", result.Error);
        Assert.Contains("category", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithInvalidRegexTransform_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate,
            ItemsPath = api.ItemsPath,
            Fields = [new ApiField { Name = "Titel", Path = "title", Transforms = [new RegexExtractTransform { Pattern = "(" }] }],
            Parameters = api.Parameters,
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Titel", result.Error);
    }

    // A fully static endpoint — every URL part fixed, nothing to enumerate
    // over — is a legitimate Api-Mode config, not just a degenerate one:
    // the extension previously forced at least one variable part before
    // "Übernehmen" was even enabled, but the underlying config format (and
    // the generated script, via itertools.product over zero value lists)
    // always supported zero parameters just fine.
    [Fact]
    public void Validate_ApiConfigWithNoParameters_Succeeds()
    {
        var api = ValidApiConfig();
        var valid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items", ItemsPath = api.ItemsPath, Fields = api.Fields, Parameters = [],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithPlaceholderMissingParameter_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?category={category}&week={week}",
            ItemsPath = api.ItemsPath, Fields = api.Fields, Parameters = api.Parameters,
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("week", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithUnusedParameter_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items",
            ItemsPath = api.ItemsPath, Fields = api.Fields, Parameters = api.Parameters,
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("category", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithDuplicateParameterNames_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?category={category}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters =
            [
                new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } },
                new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["b"] } },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Duplicate parameter names", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithEmptyStaticListSource_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?category={category}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = [] } }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("value list", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithDiscoverySourceMissingItemsPath_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?category={category}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters =
            [
                new ApiParameter
                {
                    Name = "category",
                    Source = new DiscoverySource { UrlTemplate = "https://example.com/api/categories", ItemsPath = " ", ValuePath = "id" },
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("ItemsPath", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithRangeSourceMissingTo_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?week={week}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "week", Source = new RangeSource { Type = RangeType.IsoWeek, From = "2026-W01", To = " " } }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Range for parameter", result.Error);
    }

    // Reproduces the reported bug exactly: a site (penny.de) uses "2026-35"
    // in its own URL instead of ISO-8601 "2026-W35" — this used to only
    // fail deep inside the generated script (raw Python traceback). Without
    // an explicit Format, the default "{yyyy}-W{ww}" applies and correctly
    // rejects it here instead, with a message pointing at the mismatch.
    [Fact]
    public void Validate_ApiConfigWithIsoWeekRangeNotMatchingDefaultFormat_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?week={week}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "week", Source = new RangeSource { Type = RangeType.IsoWeek, From = "2026-35", To = "2026-50" } }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("2026-35", result.Error);
        Assert.Contains("format", result.Error);
    }

    // The same From/To values succeed once a matching Format is set — this
    // is the actual fix, not just a friendlier rejection.
    [Fact]
    public void Validate_ApiConfigWithIsoWeekRangeMatchingCustomFormat_Succeeds()
    {
        var valid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?week={week}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "week", Source = new RangeSource { Type = RangeType.IsoWeek, From = "2026-35", To = "2026-50", Format = "{yyyy}-{ww}" } }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithRangeSourceInvalidFormat_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?week={week}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            // {dd} isn't a valid token for IsoWeek, and {ww} is missing.
            Parameters = [new ApiParameter { Name = "week", Source = new RangeSource { Type = RangeType.IsoWeek, From = "2026-35", To = "2026-50", Format = "{yyyy}-{dd}" } }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Format", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithNumberRangeNonIntegerValue_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?page={page}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "page", Source = new RangeSource { Type = RangeType.Number, From = "eins", To = "10" } }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("eins", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithValidDiscoverySource_Succeeds()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?category={category}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters =
            [
                new ApiParameter
                {
                    Name = "category",
                    Source = new DiscoverySource { UrlTemplate = "https://example.com/api/categories", ItemsPath = "data", ValuePath = "id" },
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.True(result.Success);
    }

    [Fact]
    public void Validate_ApiConfigWithHeaderMissingValueAndEnvironmentVariable_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath, Fields = api.Fields, Parameters = api.Parameters,
            Headers = [new ApiHeader { Name = "Authorization" }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Authorization", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithHeaderSettingBothValueAndEnvironmentVariable_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath, Fields = api.Fields, Parameters = api.Parameters,
            Headers = [new ApiHeader { Name = "Authorization", Value = "Bearer x", EnvironmentVariableName = "SF_TOKEN" }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Authorization", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithHeaderInvalidEnvironmentVariableName_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath, Fields = api.Fields, Parameters = api.Parameters,
            Headers = [new ApiHeader { Name = "Authorization", EnvironmentVariableName = "BAD-NAME" }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("environment variable name", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithDuplicateHeaderNames_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath, Fields = api.Fields, Parameters = api.Parameters,
            Headers =
            [
                new ApiHeader { Name = "Authorization", Value = "Bearer a" },
                new ApiHeader { Name = "Authorization", EnvironmentVariableName = "SF_TOKEN" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Duplicate header names", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithValidHeaders_Succeeds()
    {
        var api = ValidApiConfig();
        var valid = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath, Fields = api.Fields, Parameters = api.Parameters,
            Headers =
            [
                new ApiHeader { Name = "Accept", Value = "application/json" },
                new ApiHeader { Name = "Authorization", EnvironmentVariableName = "SF_TOKEN" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success);
    }

    // ── API-Mode: Groups (tree shape, Issue #54) ────────────────────────

    private static ApiConfig ValidApiGroupsConfig() => new()
    {
        UrlTemplate = "https://example.com/api/catalog?category={category}",
        Groups =
        [
            new ApiGroup
            {
                Name = "Kategorie",
                Path = "categories",
                Children =
                [
                    new ApiField { Name = "KategorieName", Path = "name" },
                    new ApiGroup
                    {
                        Name = "Produkt",
                        Path = "products",
                        Children = [new ApiField { Name = "Titel", Path = "title" }],
                    },
                ],
            },
        ],
        Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
    };

    [Fact]
    public void Validate_ValidApiGroupsConfig_Succeeds()
    {
        var result = ScrapingPlanValidator.Validate(ApiPlan(ValidApiGroupsConfig()));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithBothFlatAndGroups_Fails()
    {
        var flat = ValidApiConfig();
        var tree = ValidApiGroupsConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = flat.UrlTemplate, ItemsPath = flat.ItemsPath, Fields = flat.Fields,
            Groups = tree.Groups, Parameters = flat.Parameters,
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("mutually exclusive", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithNeitherFlatNorGroups_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items",
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("ItemsPath", result.Error);
        Assert.Contains("Groups", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithItemsPathButNoFields_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items",
            ItemsPath = "data.items",
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("ItemsPath and Fields", result.Error);
    }

    // ApiConfig isn't a record, so these build a fresh instance per test
    // instead of using `with` — UrlTemplate/Parameters copied verbatim from
    // ValidApiGroupsConfig(), only Groups varies per test.
    private static ApiConfig WithGroups(List<ApiGroup> groups) => new()
    {
        UrlTemplate = ValidApiGroupsConfig().UrlTemplate,
        Groups = groups,
        Parameters = ValidApiGroupsConfig().Parameters,
    };

    [Fact]
    public void Validate_ApiGroupsConfigWithEmptyGroupName_Fails()
    {
        var invalid = WithGroups([new ApiGroup { Name = " ", Path = "categories", Children = [new ApiField { Name = "Titel", Path = "title" }] }]);
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Name of an Api node", result.Error);
    }

    [Fact]
    public void Validate_ApiGroupsConfigWithEmptyGroupChildren_Fails()
    {
        var invalid = WithGroups([new ApiGroup { Name = "Kategorie", Path = "categories", Children = [] }]);
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("child element", result.Error);
    }

    [Fact]
    public void Validate_ApiGroupsConfigWithEmptyFieldPath_Fails()
    {
        var invalid = WithGroups([new ApiGroup { Name = "Kategorie", Path = "categories", Children = [new ApiField { Name = "Titel", Path = " " }] }]);
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Path of field 'Titel'", result.Error);
    }

    [Fact]
    public void Validate_ApiGroupsConfigWithInvalidRegexTransform_Fails()
    {
        var invalid = WithGroups([
            new ApiGroup
            {
                Name = "Kategorie", Path = "categories",
                Children = [new ApiField { Name = "Titel", Path = "title", Transforms = [new RegexExtractTransform { Pattern = "[unclosed" }] }],
            },
        ]);
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Titel", result.Error);
    }

    // Unlike ApiField.Path, an empty ApiGroup.Path is legitimate (see
    // ApiGroup's doc comment, "array-of-arrays") — must not be rejected the
    // way an empty ApiField.Path is above.
    [Fact]
    public void Validate_ApiGroupsConfigWithEmptyGroupPath_SucceedsWhenFieldStillReachable()
    {
        var valid = WithGroups([new ApiGroup { Name = "Zeile", Path = "", Children = [new ApiField { Name = "Wert", Path = "value" }] }]);
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    // Deeply nested groups-of-groups still succeed as long as a field is
    // reachable at the bottom — proves ApiNodesContainField's recursion
    // isn't accidentally shallow (e.g. only checking direct children).
    [Fact]
    public void Validate_ApiGroupsConfigWithFieldOnlyAtDeepestLevel_Succeeds()
    {
        var valid = WithGroups(
        [
            new ApiGroup
            {
                Name = "Aussen", Path = "outer",
                Children = [new ApiGroup { Name = "Innen", Path = "inner", Children = [new ApiGroup { Name = "GanzInnen", Path = "innermost", Children = [new ApiField { Name = "Wert", Path = "value" }] }] }],
            },
        ]);
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    // ApiNodesContainField's own "no field anywhere" branch is structurally
    // unreachable for any tree that already satisfies ValidateApiNodes'
    // "every group needs ≥1 child" rule: since JSON (and therefore any
    // ApiGroup tree built from it) is finite and acyclic, the deepest node
    // in a tree where every group has children can only be an ApiField —
    // ApiGroup is the only other ApiNode variant, and it would itself
    // require further children, contradicting "deepest". The check is kept
    // anyway for the same reason flat mode keeps its own explicit
    // "Fields.Count == 0" check rather than relying on this argument: it
    // states the actual business rule ("a config must extract something")
    // directly, instead of leaving it as an emergent property of an
    // unrelated structural rule that could change under a future refactor.
    // No dedicated [Fact] for this branch specifically, for that reason —
    // there is no way to construct a finite, otherwise-valid tree that
    // would exercise it.

    // ── API-Mode: request body (Issue #55) ──────────────────────────────

    private static ApiConfig ApiConfigWithBody(ApiBodyNode body, List<ApiParameter>? parameters = null) => new()
    {
        Method = "POST",
        UrlTemplate = "https://example.com/api/items?category={category}",
        ItemsPath = "data.items",
        Fields = [new ApiField { Name = "Titel", Path = "title" }],
        Parameters = parameters ?? [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
        Body = body,
    };

    private static ApiConfig ValidApiConfigWithPostBody() => ApiConfigWithBody(
        new ApiBodyObject
        {
            Properties = new Dictionary<string, ApiBodyNode>
            {
                ["query"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.String, StringValue = "fixed" },
                ["term"] = new ApiBodyVariable { ParameterName = "search" },
            },
        },
        [
            new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } },
            new ApiParameter { Name = "search", Source = new StaticListSource { Values = ["b"] } },
        ]);

    [Fact]
    public void Validate_ApiConfigWithPostBodyAndFlatFields_Succeeds()
    {
        var result = ScrapingPlanValidator.Validate(ApiPlan(ValidApiConfigWithPostBody()));
        Assert.True(result.Success, result.Error);
    }

    // Body (request-side) and Groups (response-side, Issue #54) are fully
    // orthogonal — a POST body and a tree-shaped response must be able to
    // coexist, exactly like a plain GET can already be combined with either
    // response shape (see Validate_ValidApiConfig_Succeeds/
    // Validate_ValidApiGroupsConfig_Succeeds above).
    [Fact]
    public void Validate_ApiConfigWithPostBodyAndGroupsTree_Succeeds()
    {
        var tree = ValidApiGroupsConfig();
        var valid = new ApiConfig
        {
            Method = "POST",
            UrlTemplate = tree.UrlTemplate,
            Groups = tree.Groups,
            Parameters = tree.Parameters,
            Body = new ApiBodyObject
            {
                Properties = new Dictionary<string, ApiBodyNode> { ["category"] = new ApiBodyVariable { ParameterName = "category" } },
            },
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithGetMethodAndBody_Fails()
    {
        var api = ValidApiConfigWithPostBody();
        var invalid = new ApiConfig
        {
            Method = "GET", UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath,
            Fields = api.Fields, Parameters = api.Parameters, Body = api.Body,
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Body", result.Error);
        Assert.Contains("POST", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithBodyReferencingUnknownParameter_Fails()
    {
        var invalid = ApiConfigWithBody(
            new ApiBodyObject { Properties = new Dictionary<string, ApiBodyNode> { ["term"] = new ApiBodyVariable { ParameterName = "doesNotExist" } } });
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("unknown parameter", result.Error);
        Assert.Contains("doesNotExist", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithBodyEmptyPropertyName_Fails()
    {
        var invalid = ApiConfigWithBody(
            new ApiBodyObject { Properties = new Dictionary<string, ApiBodyNode> { [" "] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.String, StringValue = "x" } } });
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Property name", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithStringLiteralMissingStringValue_Fails()
    {
        var invalid = ApiConfigWithBody(
            new ApiBodyObject { Properties = new Dictionary<string, ApiBodyNode> { ["x"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.String } } });
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("String", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithNumberLiteralMissingNumberValue_Fails()
    {
        var invalid = ApiConfigWithBody(
            new ApiBodyObject { Properties = new Dictionary<string, ApiBodyNode> { ["x"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.Number } } });
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Number", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithBooleanLiteralMissingBoolValue_Fails()
    {
        var invalid = ApiConfigWithBody(
            new ApiBodyObject { Properties = new Dictionary<string, ApiBodyNode> { ["x"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.Boolean } } });
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Boolean", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithNullLiteralHavingAValueSet_Fails()
    {
        var invalid = ApiConfigWithBody(
            new ApiBodyObject { Properties = new Dictionary<string, ApiBodyNode> { ["x"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.Null, StringValue = "oops" } } });
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Null", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithValidLiteralOfEveryKind_Succeeds()
    {
        var valid = ApiConfigWithBody(new ApiBodyObject
        {
            Properties = new Dictionary<string, ApiBodyNode>
            {
                ["s"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.String, StringValue = "x" },
                ["n"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.Number, NumberValue = 1 },
                ["b"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.Boolean, BoolValue = true },
                ["nil"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.Null },
            },
        });
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    // A parameter referenced only from the body — never from the
    // UrlTemplate at all — must not be flagged as "unused": the unused-
    // parameter check (originally UrlTemplate-only) now also looks at the
    // body tree, see ValidateApiConfig.
    [Fact]
    public void Validate_ApiConfigWithParameterOnlyReferencedByBody_Succeeds()
    {
        var valid = new ApiConfig
        {
            Method = "POST",
            UrlTemplate = "https://example.com/api/search",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "search", Source = new StaticListSource { Values = ["a"] } }],
            Body = new ApiBodyObject { Properties = new Dictionary<string, ApiBodyNode> { ["term"] = new ApiBodyVariable { ParameterName = "search" } } },
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    // Concretizes the case that actually motivated a typed body tree (see
    // ApiBodyNode's doc comment): a GraphQL body is just an ordinary
    // ApiBodyObject with a fixed "query" string and a nested "variables"
    // object, requiring no dedicated GraphQL concept anywhere.
    [Fact]
    public void Validate_ApiConfigWithGraphQlShapedBody_Succeeds()
    {
        var valid = new ApiConfig
        {
            Method = "POST",
            UrlTemplate = "https://example.com/graphql",
            ItemsPath = "data.categoryProducts.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["electronics"] } }],
            Body = new ApiBodyObject
            {
                Properties = new Dictionary<string, ApiBodyNode>
                {
                    ["query"] = new ApiBodyLiteral
                    {
                        Kind = ApiBodyLiteralKind.String,
                        StringValue = "query($category: String) { categoryProducts(category: $category) { items { title } } }",
                    },
                    ["variables"] = new ApiBodyObject
                    {
                        Properties = new Dictionary<string, ApiBodyNode> { ["category"] = new ApiBodyVariable { ParameterName = "category" } },
                    },
                },
            },
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    // Issue #87
    [Fact]
    public void Validate_ValidEmailChangeDetection_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            ChangeDetection = new ChangeDetectionConfig
            {
                Notify = "Email",
                Email = new EmailNotificationConfig
                {
                    SmtpHostEnvVar = "SF_SMTP_HOST", FromEnvVar = "SF_FROM", ToEnvVar = "SF_TO",
                },
            },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ValidWebhookChangeDetection_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            ChangeDetection = new ChangeDetectionConfig
            {
                Notify = "Webhook",
                Webhook = new WebhookNotificationConfig { UrlEnvVar = "SF_WEBHOOK_URL" },
            },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ChangeDetectionWithUnknownNotifyMethod_Fails()
    {
        var plan = new ScrapingPlan { Steps = ValidPlan().Steps, ChangeDetection = new ChangeDetectionConfig { Notify = "Sms" } };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("notify method", result.Error);
    }

    [Fact]
    public void Validate_ChangeDetectionEmailWithoutEmailConfig_Fails()
    {
        var plan = new ScrapingPlan { Steps = ValidPlan().Steps, ChangeDetection = new ChangeDetectionConfig { Notify = "Email" } };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Email configuration", result.Error);
    }

    [Fact]
    public void Validate_ChangeDetectionWebhookWithoutWebhookConfig_Fails()
    {
        var plan = new ScrapingPlan { Steps = ValidPlan().Steps, ChangeDetection = new ChangeDetectionConfig { Notify = "Webhook" } };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Webhook configuration", result.Error);
    }

    [Fact]
    public void Validate_ChangeDetectionEmailWithInvalidHostEnvVarName_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            ChangeDetection = new ChangeDetectionConfig
            {
                Notify = "Email",
                Email = new EmailNotificationConfig
                {
                    SmtpHostEnvVar = "not a valid name", FromEnvVar = "SF_FROM", ToEnvVar = "SF_TO",
                },
            },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Invalid environment variable name", result.Error);
        Assert.Contains("SmtpHostEnvVar", result.Error);
    }

    [Fact]
    public void Validate_ChangeDetectionEmailWithInvalidOptionalPortEnvVarName_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            ChangeDetection = new ChangeDetectionConfig
            {
                Notify = "Email",
                Email = new EmailNotificationConfig
                {
                    SmtpHostEnvVar = "SF_SMTP_HOST", SmtpPortEnvVar = "1invalid", FromEnvVar = "SF_FROM", ToEnvVar = "SF_TO",
                },
            },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("SmtpPortEnvVar", result.Error);
    }

    [Fact]
    public void Validate_ChangeDetectionWebhookWithInvalidUrlEnvVarName_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            ChangeDetection = new ChangeDetectionConfig
            {
                Notify = "Webhook",
                Webhook = new WebhookNotificationConfig { UrlEnvVar = "" },
            },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("UrlEnvVar", result.Error);
    }

    [Fact]
    public void Validate_ChangeDetectionEmailAndWebhookBothSet_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            ChangeDetection = new ChangeDetectionConfig
            {
                Notify = "Email",
                Email = new EmailNotificationConfig { SmtpHostEnvVar = "SF_SMTP_HOST", FromEnvVar = "SF_FROM", ToEnvVar = "SF_TO" },
                Webhook = new WebhookNotificationConfig { UrlEnvVar = "SF_WEBHOOK_URL" },
            },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("must not configure both Email and Webhook", result.Error);
    }

    // Issue #88
    [Fact]
    public void Validate_ValidProxy_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Proxy = new ProxyConfig { EnvironmentVariableName = "SF_PROXIES" },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ProxyWithInvalidEnvironmentVariableName_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Proxy = new ProxyConfig { EnvironmentVariableName = "not a valid name" },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Invalid environment variable name", result.Error);
        Assert.Contains("Proxy.EnvironmentVariableName", result.Error);
    }

    [Fact]
    public void Validate_NoProxy_Succeeds()
    {
        var result = ScrapingPlanValidator.Validate(ValidPlan());
        Assert.True(result.Success, result.Error);
    }

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
}