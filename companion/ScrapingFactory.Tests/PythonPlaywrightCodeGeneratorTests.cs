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
        Assert.Contains("page.wait_for_selector(\".loaded\", timeout=7000)", script);
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
        Assert.Contains("page.fill(\"#username\", os.environ[\"SF_USERNAME\"])", script);
        Assert.Contains("page.fill(\"#password\", os.environ[\"SF_PASSWORD\"])", script);
    }

    [Fact]
    public void Generate_WithClickStep_ContainsPageClick()
    {
        var script = _generator.Generate(LoginPlan());
        Assert.Contains("page.click(\"#submit\")", script);
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
        Assert.DoesNotContain("\"Titel\": [", script);
    }

    [Fact]
    public void Generate_WithFramePath_ResolverChainsFrameLocatorCalls()
    {
        var script = _generator.Generate(PlanWithFramedField());
        Assert.Contains("scope = scope.frame_locator(frame_selector)", script);
        Assert.Contains("scope.locator(selector).all()", script);
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
        Assert.Contains("page.fill(\"#user\", os.environ[\"SF_USERNAME\"])", script);
        Assert.Contains("page.click(\"#submit\")", script);

        // Textual order inside scrape() is execution order: the rendered
        // actions (fill/click) sit before the "for node in GROUPS" loop that
        // actually drives extraction — GROUPS itself is just a top-level
        // data literal declared earlier and isn't what "runs" first.
        var clickIndex = script.IndexOf("page.click", StringComparison.Ordinal);
        var extractionLoopIndex = script.IndexOf("for node in GROUPS:", StringComparison.Ordinal);
        Assert.True(clickIndex < extractionLoopIndex);
    }
}
