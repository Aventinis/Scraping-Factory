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
            new NavigateStep { Urls = ["https://books.toscrape.com"] },
            new ExtractStep { Name = "Titel", Selector = "h3 > a" },
            new ExtractStep { Name = "Link", Selector = "h3 > a", Attribute = "href" },
        ],
    };

    private static ScrapingPlan PlanWithWait() => new()
    {
        Engine = ScrapingEngine.Browser,
        Steps =
        [
            new NavigateStep { Urls = ["https://books.toscrape.com"] },
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
                new NavigateStep { Urls = ["https://example.com"] },
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
            new NavigateStep { Urls = ["https://example.com/login"] },
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
        // Issue #83: the target is no longer baked in as a literal — it
        // comes from scrape()'s own `url` parameter, since the same action
        // sequence now runs once per configured start URL (see URLS/main()).
        Assert.Contains("page.goto(url,", script);
        Assert.Contains("\"https://books.toscrape.com\"", script);
    }

    // Issue #83
    [Fact]
    public void Generate_MultipleUrls_LoopsOverUrlsAndCombinesData()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com/a", "https://example.com/b"] },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };

        var script = _generator.Generate(plan);

        Assert.Contains("""URLS = ["https://example.com/a", "https://example.com/b"]""", script);
        Assert.Contains("for url in URLS:", script);
        Assert.Contains("data.extend(scrape(url))", script);
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
        Assert.Contains("OUTPUT_PATH = \"output.csv\"", script);
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
        Assert.Contains("OUTPUT_PATH = \"browser_output.csv\"", script);
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

    // Issue #88
    [Fact]
    public void Generate_WithoutProxy_DoesNotContainProxyEnvVarAndLaunchTakesNoArgs()
    {
        var script = _generator.Generate(PlanWithoutWait());
        Assert.DoesNotContain("PROXY_ENV_VAR", script);
        Assert.Contains("p.chromium.launch()", script);
    }

    [Fact]
    public void Generate_WithProxy_ImportsOsAndParsesProxyUrlForLaunch()
    {
        var plan = PlanWithoutWait();
        plan = new ScrapingPlan
        {
            Engine = plan.Engine, Steps = plan.Steps, OutputFormat = plan.OutputFormat,
            Proxy = new ProxyConfig { EnvironmentVariableName = "SF_PROXIES" },
        };

        var script = _generator.Generate(plan);

        Assert.Contains("import os", script);
        Assert.Contains("import sys", script);
        Assert.Contains("import itertools", script);
        Assert.Contains("import urllib.parse", script);
        Assert.Contains("PROXY_ENV_VAR = 'SF_PROXIES'", script);
        Assert.Contains("_PROXY_ENV_VALUE = os.environ.get(PROXY_ENV_VAR)", script);
        Assert.Contains("def _next_playwright_proxy():", script);
        Assert.Contains("p.chromium.launch(proxy=_next_playwright_proxy())", script);
        Assert.Contains("EXIT_MISSING_ENV_VAR = 78", script);
    }

    [Fact]
    public void Generate_WithFillStep_ReadsValueFromEnvironmentVariable()
    {
        var script = _generator.Generate(LoginPlan());
        Assert.Contains("_resolve_locator(page, \"#username\", None).fill(_require_env(\"SF_USERNAME\"))", script);
        Assert.Contains("_resolve_locator(page, \"#password\", None).fill(_require_env(\"SF_PASSWORD\"))", script);
        Assert.Contains("def _require_env(name):", script);
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
            new NavigateStep { Urls = ["https://example.com"] },
            new ScrollStep { MaxIterations = 5, WaitAfterMs = 250 },
            new ExtractStep { Name = "Titel", Selector = ".item" },
        ],
    };

    private static ScrapingPlan ScrollWithContainerAndButtonPlan() => new()
    {
        Engine = ScrapingEngine.Browser,
        Steps =
        [
            new NavigateStep { Urls = ["https://example.com"] },
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
            new NavigateStep { Urls = ["https://example.com"] },
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
            new NavigateStep { Urls = ["https://example.com/speisekarte"] },
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
            new NavigateStep { Urls = ["https://example.com/login"] },
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
        Assert.Contains("_resolve_locator(page, \"#user\", None).fill(_require_env(\"SF_USERNAME\"))", script);
        Assert.Contains("_resolve_locator(page, \"#submit\", None).click()", script);

        // Textual order inside scrape() is execution order: the rendered
        // actions (fill/click) sit before the "for node in GROUPS" loop that
        // actually drives extraction — GROUPS itself is just a top-level
        // data literal declared earlier and isn't what "runs" first.
        var clickIndex = script.IndexOf(".click()", StringComparison.Ordinal);
        var extractionLoopIndex = script.IndexOf("for node in GROUPS:", StringComparison.Ordinal);
        Assert.True(clickIndex < extractionLoopIndex);
    }

    // Issue #88
    [Fact]
    public void Generate_GroupPlanWithProxy_WiresProxyIntoLaunch()
    {
        var plan = GroupPlan();
        plan = new ScrapingPlan
        {
            Engine = plan.Engine, Steps = plan.Steps, OutputFormat = plan.OutputFormat,
            Proxy = new ProxyConfig { EnvironmentVariableName = "SF_PROXIES" },
        };

        var script = _generator.Generate(plan);

        Assert.Contains("PROXY_ENV_VAR = 'SF_PROXIES'", script);
        Assert.Contains("p.chromium.launch(proxy=_next_playwright_proxy())", script);
    }

    // ── Container-Mode FramePath (Issue #42, Phase 3) ───────────────────────

    private static ScrapingPlan GroupPlanWithFramedField() => new()
    {
        Engine = ScrapingEngine.Browser,
        Steps =
        [
            new NavigateStep { Urls = ["https://example.com/speisekarte"] },
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
            new NavigateStep { Urls = ["https://example.com/speisekarte"] },
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
            new NavigateStep { Urls = ["https://example.com/login"] },
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
        Assert.Contains("_resolve_locator(page, \"#user\", [\"iframe#sso\"]).fill(_require_env(\"SF_USERNAME\"))", script);
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

    // Issue #174
    [Fact]
    public void Generate_WithNextLinkPagination_EmitsSelectorConstantAndSameSessionGoto()
    {
        var plan = PlanWithoutWait();
        plan = new ScrapingPlan
        {
            Engine = plan.Engine, Steps = plan.Steps, OutputFormat = plan.OutputFormat,
            ScriptFileName = plan.ScriptFileName, OutputFileBaseName = plan.OutputFileBaseName,
            Pagination = new NextLinkPagination { NextLinkSelector = "a.next", MaxPages = 12 },
        };

        var script = _generator.Generate(plan);

        Assert.Contains("PAGINATION_MAX_PAGES = 12", script);
        Assert.Contains("PAGINATION_NEXT_LINK_SELECTOR = 'a.next'", script);
        Assert.Contains("def _extract_page_rows(page):", script);
        Assert.Contains("next_el = page.query_selector(PAGINATION_NEXT_LINK_SELECTOR)", script);
        // Reuses the same page/browser session (page.goto), never relaunches.
        Assert.Contains("page.goto(urllib.parse.urljoin(page.url, next_href), wait_until=\"load\", timeout=30000)", script);
        Assert.DoesNotContain("PAGINATION_URL_TEMPLATE", script);
    }

    [Fact]
    public void Generate_NoPagination_OmitsPaginationCodeEntirely()
    {
        var script = _generator.Generate(PlanWithoutWait());

        Assert.DoesNotContain("PAGINATION_", script);
        Assert.Contains("def _extract_page_rows(page):", script);
    }

    // Issue #175
    [Fact]
    public void Generate_WithoutPersistentSession_OmitsSessionStateCodeAndUsesPlainNewPage()
    {
        var script = _generator.Generate(PlanWithoutWait());

        Assert.DoesNotContain("SESSION_STATE_PATH", script);
        Assert.DoesNotContain("new_context", script);
        Assert.Contains("page = browser.new_page()", script);
    }

    [Fact]
    public void Generate_WithPersistentSession_UsesContextWithStorageStateAndSavesAfterwards()
    {
        var plan = LoginPlan();
        plan = new ScrapingPlan
        {
            Engine = plan.Engine, Steps = plan.Steps, OutputFormat = plan.OutputFormat, PersistentSession = true,
        };

        var script = _generator.Generate(plan);

        Assert.Contains("import os", script);
        Assert.Contains("SESSION_STATE_PATH = OUTPUT_PATH + \".session-state.json\"", script);
        Assert.Contains("_session_exists = os.path.exists(SESSION_STATE_PATH)", script);
        Assert.Contains("context = browser.new_context(storage_state=SESSION_STATE_PATH if _session_exists else None)", script);
        Assert.Contains("page = context.new_page()", script);
        Assert.Contains("context.storage_state(path=SESSION_STATE_PATH)", script);

        // The login-only actions (Fill/Click) are nested inside the
        // skip-on-reuse guard; Navigate itself runs unconditionally, outside
        // of it.
        Assert.Contains("if not _session_exists:", script);
        var gotoIndex = script.IndexOf("page.goto(url,", StringComparison.Ordinal);
        var guardIndex = script.IndexOf("if not _session_exists:", StringComparison.Ordinal);
        var fillIndex = script.IndexOf(".fill(_require_env(\"SF_USERNAME\"))", StringComparison.Ordinal);
        Assert.True(gotoIndex < guardIndex);
        Assert.True(guardIndex < fillIndex);
    }

    [Fact]
    public void Generate_WithPersistentSessionAndNoLoginActions_OmitsSkipGuardButStillPersistsSession()
    {
        var plan = PlanWithoutWait();
        plan = new ScrapingPlan
        {
            Engine = plan.Engine, Steps = plan.Steps, OutputFormat = plan.OutputFormat, PersistentSession = true,
        };

        var script = _generator.Generate(plan);

        Assert.Contains("SESSION_STATE_PATH", script);
        Assert.Contains("context.storage_state(path=SESSION_STATE_PATH)", script);
        // Nothing to skip — a fresh context is still established every time,
        // but there's no "if not _session_exists:" guard with an empty body,
        // which would be a Python SyntaxError.
        Assert.DoesNotContain("if not _session_exists:", script);
    }

    [Fact]
    public void Generate_GroupPlanWithPersistentSession_UsesContextWithStorageState()
    {
        var plan = GroupPlanWithLogin();
        plan = new ScrapingPlan
        {
            Engine = plan.Engine, Steps = plan.Steps, OutputFormat = plan.OutputFormat, PersistentSession = true,
        };

        var script = _generator.Generate(plan);

        Assert.Contains("SESSION_STATE_PATH = OUTPUT_PATH + \".session-state.json\"", script);
        Assert.Contains("context = browser.new_context(storage_state=SESSION_STATE_PATH if _session_exists else None)", script);
        Assert.Contains("if not _session_exists:", script);
        Assert.Contains("context.storage_state(path=SESSION_STATE_PATH)", script);
    }
}
