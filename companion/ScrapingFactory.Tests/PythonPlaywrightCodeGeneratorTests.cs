using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class PythonPlaywrightCodeGeneratorTests
{
    private readonly PythonPlaywrightCodeGenerator _generator = new();

    private static ScrapingPlan PlanWithoutWait() => new()
    {
        Engine = ScrapingEngine.Browser,
        Steps =
        [
            new NavigateStep { Url = "https://books.toscrape.com" },
            new ExtractStep { Name = "Titel", Selector = "h3 > a" },
            new ExtractStep { Name = "Link", Selector = "h3 > a", Attribute = "href" },
        ],
    };

    private static ScrapingPlan PlanWithWait() => new()
    {
        Engine = ScrapingEngine.Browser,
        Steps =
        [
            new NavigateStep { Url = "https://books.toscrape.com" },
            new WaitForStep { Selector = ".loaded", TimeoutMs = 7000 },
            new ExtractStep { Name = "Titel", Selector = "h3 > a" },
        ],
    };

    [Fact]
    public void Generate_FieldWithTransforms_RendersTransformChainAndRuntimeHelper()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Url = "https://example.com" },
                new ExtractStep { Name = "Preis", Selector = ".price", Transforms = [new TrimTransform(), new ToNumberTransform()] },
            ],
        };

        var script = _generator.Generate(plan);
        Assert.Contains("""{"kind": "trim"}""", script);
        Assert.Contains("""{"kind": "toNumber"}""", script);
        Assert.Contains("def _apply_transforms(value, transforms):", script);
        Assert.Contains("row[name] = _apply_transforms(raw_value, TRANSFORMS.get(name, []))", script);
    }

    private static ScrapingPlan LoginPlan() => new()
    {
        Engine = ScrapingEngine.Browser,
        Steps =
        [
            new NavigateStep { Url = "https://example.com/login" },
            new FillStep { Selector = "#username", EnvironmentVariableName = "SF_USERNAME" },
            new FillStep { Selector = "#password", EnvironmentVariableName = "SF_PASSWORD" },
            new ClickStep { Selector = "#submit" },
            new ExtractStep { Name = "Titel", Selector = "h1" },
        ],
    };

    [Fact]
    public void Generate_ContainsTargetUrl()
    {
        var script = _generator.Generate(PlanWithoutWait());
        Assert.Contains("https://books.toscrape.com", script);
    }

    [Fact]
    public void Generate_ContainsPlaywrightImport()
    {
        var script = _generator.Generate(PlanWithoutWait());
        Assert.Contains("from playwright.sync_api import sync_playwright", script);
    }

    [Fact]
    public void Generate_ContainsPageGoto()
    {
        var script = _generator.Generate(PlanWithoutWait());
        Assert.Contains("page.goto(\"https://books.toscrape.com\"", script);
    }

    [Fact]
    public void Generate_WithoutWaitForStep_DoesNotContainWaitForSelector()
    {
        var script = _generator.Generate(PlanWithoutWait());
        Assert.DoesNotContain("wait_for_selector", script);
    }

    [Fact]
    public void Generate_WithWaitForStep_ContainsWaitForSelectorWithTimeout()
    {
        var script = _generator.Generate(PlanWithWait());
        Assert.Contains("_resolve_locator(page, \".loaded\", None).wait_for(timeout=7000)", script);
    }

    [Fact]
    public void Generate_AttributeFieldAppearsInAttributesDict()
    {
        var script = _generator.Generate(PlanWithoutWait());
        Assert.Contains("\"Link\": \"href\"", script);
    }

    [Fact]
    public void Generate_ContainsCsvDictWriter()
    {
        var script = _generator.Generate(PlanWithoutWait());
        Assert.Contains("csv.DictWriter", script);
    }

    [Fact]
    public void Generate_DefaultsToScraperAndOutputFileNames()
    {
        var script = _generator.Generate(PlanWithoutWait());
        Assert.Contains("python scraper.py", script);
        Assert.Contains("open(\"output.csv\"", script);
    }

    [Fact]
    public void Generate_UsesConfiguredFileNames()
    {
        var plan = PlanWithoutWait();
        plan = new ScrapingPlan
        {
            Steps = plan.Steps, OutputFormat = plan.OutputFormat, Engine = plan.Engine,
            ScriptFileName = "browser_scraper", OutputFileBaseName = "browser_output",
        };

        var script = _generator.Generate(plan);

        Assert.Contains("python browser_scraper.py", script);
        Assert.Contains("open(\"browser_output.csv\"", script);
        Assert.DoesNotContain("\"output.csv\"", script);
    }

    [Fact]
    public void Generate_WithoutFillStep_DoesNotImportOs()
    {
        var script = _generator.Generate(PlanWithoutWait());
        Assert.DoesNotContain("import os", script);
    }

    [Fact]
    public void Generate_WithFillStep_ImportsOs()
    {
        var script = _generator.Generate(LoginPlan());
        Assert.Contains("import os", script);
    }

    [Fact]
    public void Generate_WithFillStep_ReadsValueFromEnvironmentVariable()
    {
        var script = _generator.Generate(LoginPlan());
        Assert.Contains("_resolve_locator(page, \"#username\", None).fill(os.environ[\"SF_USERNAME\"])", script);
        Assert.Contains("_resolve_locator(page, \"#password\", None).fill(os.environ[\"SF_PASSWORD\"])", script);
    }

    [Fact]
    public void Generate_WithClickStep_ContainsPageClick()
    {
        var script = _generator.Generate(LoginPlan());
        Assert.Contains("_resolve_locator(page, \"#submit\", None).click()", script);
    }

    // ── ScrollStep ───────────────────────────────────────────────────────

    private static ScrapingPlan ScrollOnlyPlan() => new()
    {
        Engine = ScrapingEngine.Browser,
        Steps =
        [
            new NavigateStep { Url = "https://example.com" },
            new ScrollStep { MaxIterations = 5, WaitAfterMs = 250 },
            new ExtractStep { Name = "Titel", Selector = ".item" },
        ],
    };

    private static ScrapingPlan ScrollWithContainerAndButtonPlan() => new()
    {
        Engine = ScrapingEngine.Browser,
        Steps =
        [
            new NavigateStep { Url = "https://example.com" },
            new ScrollStep
            {
                ContainerSelector = "#list", LoadMoreButtonSelector = ".load-more",
                MaxIterations = 3, WaitAfterMs = 500,
            },
            new ExtractStep { Name = "Titel", Selector = ".item" },
        ],
    };

    [Fact]
    public void Generate_WithoutScrollStep_DoesNotContainScrollLoop()
    {
        var script = _generator.Generate(PlanWithoutWait());
        Assert.DoesNotContain("_scroll_prev_height", script);
    }

    [Fact]
    public void Generate_ScrollOnly_ScrollsWholePageAndHasNoButtonClick()
    {
        var script = _generator.Generate(ScrollOnlyPlan());
        Assert.Contains("for _ in range(5):", script);
        Assert.Contains("window.scrollTo(0, document.body.scrollHeight)", script);
        Assert.Contains("page.wait_for_timeout(250)", script);
        Assert.Contains("_scroll_container_selector = None", script);
        Assert.Contains("_scroll_load_more_selector = None", script);
    }

    [Fact]
    public void Generate_ScrollWithContainerAndButton_ScrollsContainerAndClicksButton()
    {
        var script = _generator.Generate(ScrollWithContainerAndButtonPlan());
        Assert.Contains("_scroll_container_selector = \"#list\"", script);
        Assert.Contains("_scroll_load_more_selector = \".load-more\"", script);
        Assert.Contains("el.scrollTop = el.scrollHeight", script);
        Assert.Contains("for _ in range(3):", script);
        Assert.Contains("page.wait_for_timeout(500)", script);
    }

    // ── FramePath (Issue #42) ───────────────────────────────────────────────

    private static ScrapingPlan PlanWithFramedField() => new()
    {
        Engine = ScrapingEngine.Browser,
        Steps =
        [
            new NavigateStep { Url = "https://example.com" },
            new ExtractStep { Name = "Titel", Selector = "h3 > a" },
            new ExtractStep { Name = "Preis", Selector = ".price", FramePath = ["iframe#outer", "iframe.inner"] },
        ],
    };

    [Fact]
    public void Generate_WithoutFramePath_FramePathsDictIsEmpty()
    {
        // _resolve_elements/frame_locator is always emitted (general-case
        // Python, decided by data at runtime — see FRAME_PATHS.get(name)
        // returning None for a field with no FramePath) rather than
        // conditionally rendered, so this checks the dict content instead of
        // absence of the helper itself.
        var script = _generator.Generate(PlanWithoutWait());
        Assert.Contains("FRAME_PATHS = {\n}", script.Replace("\r\n", "\n"));
        Assert.Contains("_resolve_elements(page, sel, FRAME_PATHS.get(name))", script);
    }

    [Fact]
    public void Generate_WithFramePath_OnlyFramedFieldAppearsInFramePathsDict()
    {
        var script = _generator.Generate(PlanWithFramedField());
        Assert.Contains("\"Preis\": [\"iframe#outer\", \"iframe.inner\"]", script);
        // Scoped to the FRAME_PATHS dict itself (up to its own closing
        // brace), not the whole script — Issue #84's TRANSFORMS dict further
        // down legitimately has a "Titel": [] entry regardless of FramePath.
        var framePathsSection = script[(script.IndexOf("FRAME_PATHS") + "FRAME_PATHS".Length)..].Split("}")[0];
        Assert.DoesNotContain("\"Titel\": [", framePathsSection);
    }

    [Fact]
    public void Generate_WithFramePath_ResolverChainsFrameLocatorCalls()
    {
        var script = _generator.Generate(PlanWithFramedField());
        Assert.Contains("scope = scope.frame_locator(frame_selector)", script);
        Assert.Contains("_resolve_frame_locator(page, frame_path).locator(selector).all()", script);
    }

    // ── Container-Mode ────────────────────────────────────────────────────

    private static ScrapingPlan GroupPlan() => new()
    {
        Engine = ScrapingEngine.Browser,
        Steps =
        [
            new NavigateStep { Url = "https://example.com/speisekarte" },
            new ExtractGroupStep
            {
                Roots =
                [
                    new GroupNode
                    {
                        Name = "Kategorie",
                        Selector = "section.menu-category",
                        Repeating = true,
                        Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }],
                    },
                ],
            },
        ],
    };

    // Container-Mode is orthogonal to a preceding login flow — Navigate/
    // Fill/Click still run first, only the extraction phase after them
    // changes (group tree → XML instead of flat fields → CSV).
    private static ScrapingPlan GroupPlanWithLogin() => new()
    {
        Engine = ScrapingEngine.Browser,
        Steps =
        [
            new NavigateStep { Url = "https://example.com/login" },
            new FillStep { Selector = "#user", EnvironmentVariableName = "SF_USERNAME" },
            new ClickStep { Selector = "#submit" },
            new ExtractGroupStep
            {
                Roots =
                [
                    new GroupNode
                    {
                        Name = "Kategorie",
                        Selector = "section.menu-category",
                        Repeating = true,
                        Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }],
                    },
                ],
            },
        ],
    };

    [Fact]
    public void Generate_GroupPlan_ContainsGroupsLiteralAndXmlWrite()
    {
        var script = _generator.Generate(GroupPlan());
        Assert.Contains("GROUPS = [", script);
        Assert.Contains("\"name\": 'Kategorie'", script);
        Assert.Contains("import xml.etree.ElementTree as ET", script);
        Assert.Contains("output.xml", script);
    }

    [Fact]
    public void Generate_GroupPlan_UsesConfiguredFileNames()
    {
        var plan = GroupPlan();
        plan = new ScrapingPlan
        {
            Steps = plan.Steps, OutputFormat = plan.OutputFormat, Engine = plan.Engine,
            ScriptFileName = "menu_scraper", OutputFileBaseName = "menu",
        };

        var script = _generator.Generate(plan);

        Assert.Contains("python menu_scraper.py", script);
        Assert.Contains("menu.xml", script);
        Assert.DoesNotContain("output.xml", script);
    }

    [Fact]
    public void Generate_GroupPlan_UsesQuerySelectorNotBeautifulSoupSelect()
    {
        var script = _generator.Generate(GroupPlan());
        Assert.Contains("scope.query_selector_all(node[\"selector\"])", script);
        Assert.Contains("scope.query_selector(node[\"selector\"])", script);
    }

    [Fact]
    public void Generate_GroupPlan_DoesNotContainFlatFieldsScaffolding()
    {
        var script = _generator.Generate(GroupPlan());
        Assert.DoesNotContain("SELECTORS = {", script);
        Assert.DoesNotContain("csv.DictWriter", script);
    }

    [Fact]
    public void Generate_GroupPlanWithLogin_RendersFillAndClickBeforeExtraction()
    {
        var script = _generator.Generate(GroupPlanWithLogin());
        Assert.Contains("_resolve_locator(page, \"#user\", None).fill(os.environ[\"SF_USERNAME\"])", script);
        Assert.Contains("_resolve_locator(page, \"#submit\", None).click()", script);

        // Textual order inside scrape() is execution order: the rendered
        // actions (fill/click) sit before the "for node in GROUPS" loop that
        // actually drives extraction — GROUPS itself is just a top-level
        // data literal declared earlier and isn't what "runs" first.
        var clickIndex = script.IndexOf(".click()", StringComparison.Ordinal);
        var extractionLoopIndex = script.IndexOf("for node in GROUPS:", StringComparison.Ordinal);
        Assert.True(clickIndex < extractionLoopIndex);
    }

    // ── Container-Mode FramePath (Issue #42, Phase 3) ───────────────────────

    private static ScrapingPlan GroupPlanWithFramedField() => new()
    {
        Engine = ScrapingEngine.Browser,
        Steps =
        [
            new NavigateStep { Url = "https://example.com/speisekarte" },
            new ExtractGroupStep
            {
                Roots =
                [
                    new GroupNode
                    {
                        Name = "Kategorie",
                        Selector = "section.menu-category",
                        Repeating = true,
                        Children =
                        [
                            new DataFieldNode { Name = "Titel", Selector = "h2" },
                            new DataFieldNode { Name = "Preis", Selector = ".price", FramePath = ["iframe#widget"] },
                        ],
                    },
                ],
            },
        ],
    };

    private static ScrapingPlan GroupPlanWithFramedGroup() => new()
    {
        Engine = ScrapingEngine.Browser,
        Steps =
        [
            new NavigateStep { Url = "https://example.com/speisekarte" },
            new ExtractGroupStep
            {
                Roots =
                [
                    new GroupNode
                    {
                        Name = "Kategorie",
                        Selector = "section.menu-category",
                        Repeating = true,
                        FramePath = ["iframe#widget"],
                        Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }],
                    },
                ],
            },
        ],
    };

    [Fact]
    public void Generate_GroupPlan_ContainsFrameResolverHelpers()
    {
        var script = _generator.Generate(GroupPlan());
        Assert.Contains("def _resolve_group_matches(page, scope, node):", script);
        Assert.Contains("def _resolve_field_match(page, scope, node):", script);
        Assert.Contains("def extract_group(page, scope, node):", script);
    }

    [Fact]
    public void Generate_GroupPlanWithoutFramePath_TreeLiteralHasNoFramePathKey()
    {
        // "frame_path" (no colon) also appears in the resolver helpers' own
        // doc comments — checking for the dict-key form specifically.
        var script = _generator.Generate(GroupPlan());
        Assert.DoesNotContain("\"frame_path\":", script);
    }

    [Fact]
    public void Generate_GroupPlanWithFramedField_TreeLiteralContainsFramePath()
    {
        var script = _generator.Generate(GroupPlanWithFramedField());
        Assert.Contains("\"name\": 'Preis', \"selector\": '.price', \"mode\": 'text', \"frame_path\": ['iframe#widget']", script);
    }

    [Fact]
    public void Generate_GroupPlanWithFramedGroup_TreeLiteralContainsFramePathBeforeChildren()
    {
        var script = _generator.Generate(GroupPlanWithFramedGroup());
        Assert.Contains("\"repeating\": True, \"frame_path\": ['iframe#widget'], \"children\":", script);
    }

    // ── FramePath for Action Steps (Issue #42, Phase 4) ─────────────────────

    private static ScrapingPlan FramedActionStepsPlan() => new()
    {
        Engine = ScrapingEngine.Browser,
        Steps =
        [
            new NavigateStep { Url = "https://example.com/login" },
            new FillStep { Selector = "#user", EnvironmentVariableName = "SF_USERNAME", FramePath = ["iframe#sso"] },
            new ClickStep { Selector = "#submit", FramePath = ["iframe#sso"] },
            new WaitForStep { Selector = ".welcome", TimeoutMs = 3000, FramePath = ["iframe#sso"] },
            new ScrollStep { LoadMoreButtonSelector = "#more", FramePath = ["iframe#sso"] },
            new ExtractStep { Name = "Titel", Selector = "h1" },
        ],
    };

    [Fact]
    public void Generate_FramedFillStep_ChainsResolveLocatorWithFramePath()
    {
        var script = _generator.Generate(FramedActionStepsPlan());
        Assert.Contains("_resolve_locator(page, \"#user\", [\"iframe#sso\"]).fill(os.environ[\"SF_USERNAME\"])", script);
    }

    [Fact]
    public void Generate_FramedClickStep_ChainsResolveLocatorWithFramePath()
    {
        var script = _generator.Generate(FramedActionStepsPlan());
        Assert.Contains("_resolve_locator(page, \"#submit\", [\"iframe#sso\"]).click()", script);
    }

    [Fact]
    public void Generate_FramedWaitForStep_ChainsResolveLocatorWithFramePath()
    {
        var script = _generator.Generate(FramedActionStepsPlan());
        Assert.Contains("_resolve_locator(page, \".welcome\", [\"iframe#sso\"]).wait_for(timeout=3000)", script);
    }

    [Fact]
    public void Generate_FramedScrollStep_SetsScrollFramePathVariable()
    {
        var script = _generator.Generate(FramedActionStepsPlan());
        Assert.Contains("_scroll_frame_path = [\"iframe#sso\"]", script);
        Assert.Contains("_resolve_locator(page, _scroll_load_more_selector, _scroll_frame_path)", script);
    }

    [Fact]
    public void Generate_UnframedActionSteps_PassNoneAsFramePath()
    {
        var script = _generator.Generate(LoginPlan());
        Assert.Contains("_resolve_locator(page, \"#username\", None)", script);
        Assert.Contains("_resolve_locator(page, \"#submit\", None)", script);
    }

    [Fact]
    public void Generate_UnframedScrollStep_SetsScrollFramePathToNone()
    {
        var script = _generator.Generate(ScrollOnlyPlan());
        Assert.Contains("_scroll_frame_path = None", script);
    }
}
