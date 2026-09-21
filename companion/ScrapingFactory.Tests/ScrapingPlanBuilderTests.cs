using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class ScrapingPlanBuilderTests
{
    // Issue #182: one ExtractionBlockStep replaces the flat Fields/Groups
    // branches wholesale — each ExtractionBlockConfig resolves its own
    // name/output filename/format the same way the whole plan does for the
    // single-shape case, just once per block.
    [Fact]
    public void Build_Blocks_ResolvesShapeNameAndOutputFormatPerBlock()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Blocks =
            [
                new ExtractionBlockConfig
                {
                    Name = "Flat Block", OutputFileName = "flat-out",
                    Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
                },
                new ExtractionBlockConfig
                {
                    Name = "Group Block", OutputFileName = "group-out",
                    Groups = [new GroupNode { Name = "Item", Selector = ".item", Repeating = true, Children = [] }],
                },
            ],
        };

        var plan = ScrapingPlanBuilder.Build(config);

        var blockStep = Assert.Single(plan.Steps.OfType<ExtractionBlockStep>());
        Assert.Equal(2, blockStep.Blocks.Count);

        var flat = blockStep.Blocks[0];
        Assert.Equal("Flat Block", flat.Name);
        Assert.Equal("flat-out", flat.OutputFileBaseName);
        Assert.Equal(OutputFormat.Csv, flat.OutputFormat);
        Assert.NotNull(flat.Fields);
        Assert.Null(flat.Groups);

        var group = blockStep.Blocks[1];
        Assert.Equal("Group Block", group.Name);
        Assert.Equal("group-out", group.OutputFileBaseName);
        Assert.Equal(OutputFormat.Xml, group.OutputFormat);
        Assert.NotNull(group.Groups);
        Assert.Null(group.Fields);
    }

    [Fact]
    public void Build_Blocks_BlankNameAndOutputFileNameFallBackToIndexAndSanitizedName()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Blocks =
            [
                new ExtractionBlockConfig { Fields = [new ScrapingField { Name = "A", Selector = "a" }] },
                new ExtractionBlockConfig { Name = "Käse & Co", Fields = [new ScrapingField { Name = "B", Selector = "b" }] },
            ],
        };

        var plan = ScrapingPlanBuilder.Build(config);

        var blockStep = Assert.Single(plan.Steps.OfType<ExtractionBlockStep>());
        Assert.Equal("block_1", blockStep.Blocks[0].Name);
        // A blank OutputFileName falls back to the resolved block Name
        // itself (sanitized) rather than straight to "output_N" — here
        // that's the already-defaulted "block_1", which is already a valid
        // filename base, so SanitizeBaseName returns it unchanged.
        Assert.Equal("block_1", blockStep.Blocks[0].OutputFileBaseName);
        Assert.Equal("Käse & Co", blockStep.Blocks[1].Name);
        // Sanitized the same way FileNameSanitizer sanitizes any other
        // user-typed base name — each run of one-or-more non-[A-Za-z0-9_-]
        // characters collapses to a single '_' ("ä" and " & " each become
        // one underscore, not one per character).
        Assert.Equal("K_se_Co", blockStep.Blocks[1].OutputFileBaseName);
    }

    [Fact]
    public void Build_Blocks_ExplicitOutputFormatOverridesShapeDefault()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Blocks =
            [
                new ExtractionBlockConfig
                {
                    Name = "a", OutputFormat = OutputFormat.Json,
                    Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
                },
                new ExtractionBlockConfig
                {
                    Name = "b",
                    Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
                },
            ],
        };

        var plan = ScrapingPlanBuilder.Build(config);

        var blockStep = Assert.Single(plan.Steps.OfType<ExtractionBlockStep>());
        Assert.Equal(OutputFormat.Json, blockStep.Blocks[0].OutputFormat);
        Assert.Equal(OutputFormat.Csv, blockStep.Blocks[1].OutputFormat);
    }

    [Fact]
    public void Build_ProducesNavigateStepFollowedByOneExtractStepPerField()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields =
            [
                new ScrapingField { Name = "Titel", Selector = "h1" },
                new ScrapingField { Name = "Link", Selector = "a", Attribute = "href" },
            ],
        };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Equal(3, plan.Steps.Count);

        var navigate = Assert.IsType<NavigateStep>(plan.Steps[0]);
        Assert.Equal(["https://example.com"], navigate.Urls);

        var titel = Assert.IsType<ExtractStep>(plan.Steps[1]);
        Assert.Equal("Titel", titel.Name);
        Assert.Equal("h1", titel.Selector);
        Assert.Null(titel.Attribute);

        var link = Assert.IsType<ExtractStep>(plan.Steps[2]);
        Assert.Equal("Link", link.Name);
        Assert.Equal("a", link.Selector);
        Assert.Equal("href", link.Attribute);
    }

    [Fact]
    public void Build_PreservesOutputFormat()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
            OutputFormat = OutputFormat.Csv,
        };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Equal(OutputFormat.Csv, plan.OutputFormat);
    }

    [Fact]
    public void Build_NoFields_ProducesOnlyNavigateStep()
    {
        var config = new ScrapingConfig { Url = "https://example.com" };

        var plan = ScrapingPlanBuilder.Build(config);

        var step = Assert.Single(plan.Steps);
        Assert.IsType<NavigateStep>(step);
    }

    // Issue #83
    [Fact]
    public void Build_AdditionalUrls_CombinesWithPrimaryUrlInOrder()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com/a",
            AdditionalUrls = ["https://example.com/b", "https://example.com/c"],
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
        };

        var plan = ScrapingPlanBuilder.Build(config);

        var navigate = Assert.IsType<NavigateStep>(plan.Steps[0]);
        Assert.Equal(
            ["https://example.com/a", "https://example.com/b", "https://example.com/c"],
            navigate.Urls);
    }

    [Fact]
    public void Build_AdditionalUrls_TrimsAndDropsBlankEntries()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com/a",
            AdditionalUrls = ["  https://example.com/b  ", "", "   ", "https://example.com/c"],
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
        };

        var plan = ScrapingPlanBuilder.Build(config);

        var navigate = Assert.IsType<NavigateStep>(plan.Steps[0]);
        Assert.Equal(
            ["https://example.com/a", "https://example.com/b", "https://example.com/c"],
            navigate.Urls);
    }

    [Fact]
    public void Build_NoAdditionalUrls_UrlsContainsOnlyPrimaryUrl()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
        };

        var plan = ScrapingPlanBuilder.Build(config);

        var navigate = Assert.IsType<NavigateStep>(plan.Steps[0]);
        Assert.Equal(["https://example.com"], navigate.Urls);
    }

    [Fact]
    public void Build_DefaultsToStaticEngine()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
        };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Equal(ScrapingEngine.Static, plan.Engine);
    }

    [Fact]
    public void Build_PreservesBrowserEngine()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
            Engine = ScrapingEngine.Browser,
        };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Equal(ScrapingEngine.Browser, plan.Engine);
    }

    [Fact]
    public void Build_DefaultsFileNamesWhenNotGiven()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
        };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Equal("scraper", plan.ScriptFileName);
        Assert.Equal("output", plan.OutputFileBaseName);
    }

    [Fact]
    public void Build_SanitizesFileNames()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
            ScriptFileName = "../../etc/passwd",
            OutputFileName = "my results!",
        };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Equal("etc_passwd", plan.ScriptFileName);
        Assert.Equal("my_results", plan.OutputFileBaseName);
    }

    private static List<GroupNode> SampleGroups() =>
    [
        new GroupNode
        {
            Name = "Kategorie",
            Selector = "section.menu-category",
            Repeating = true,
            Children =
            [
                new DataFieldNode { Name = "Titel", Selector = "h2" },
            ],
        },
    ];

    [Fact]
    public void Build_Groups_ProducesNavigateStepFollowedByOneExtractGroupStep()
    {
        var config = new ScrapingConfig { Url = "https://example.com", Groups = SampleGroups() };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Equal(2, plan.Steps.Count);
        Assert.IsType<NavigateStep>(plan.Steps[0]);
        var groupStep = Assert.IsType<ExtractGroupStep>(plan.Steps[1]);
        Assert.Same(config.Groups, groupStep.Roots);
    }

    [Fact]
    public void Build_Groups_ForcesXmlOutputFormatRegardlessOfConfig()
    {
        var config = new ScrapingConfig { Url = "https://example.com", Groups = SampleGroups(), OutputFormat = OutputFormat.Csv };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Equal(OutputFormat.Xml, plan.OutputFormat);
    }

    [Fact]
    public void Build_Groups_WithJsonOutputFormat_KeepsJsonInsteadOfXml()
    {
        var config = new ScrapingConfig { Url = "https://example.com", Groups = SampleGroups(), OutputFormat = OutputFormat.Json };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Equal(OutputFormat.Json, plan.OutputFormat);
    }

    [Fact]
    public void Build_Groups_AlsoSanitizesFileNames()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com", Groups = SampleGroups(),
            ScriptFileName = "my scraper", OutputFileName = "my export",
        };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Equal("my_scraper", plan.ScriptFileName);
        Assert.Equal("my_export", plan.OutputFileBaseName);
    }

    // ── BrowserActions (Issue #41) ──────────────────────────────────────

    [Fact]
    public void Build_BrowserActions_TranslatesToStepsInOrderBeforeExtraction()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Engine = ScrapingEngine.Browser,
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
            BrowserActions =
            [
                new WaitForAction { Selector = ".loaded", TimeoutMs = 3000 },
                new FillAction { Selector = "#user", EnvironmentVariableName = "SF_USERNAME" },
                new ClickAction { Selector = "#submit" },
                new ScrollAction { ContainerSelector = "#list", LoadMoreButtonSelector = ".more", MaxIterations = 4, WaitAfterMs = 750 },
            ],
        };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Equal(6, plan.Steps.Count);
        Assert.IsType<NavigateStep>(plan.Steps[0]);

        var wait = Assert.IsType<WaitForStep>(plan.Steps[1]);
        Assert.Equal(".loaded", wait.Selector);
        Assert.Equal(3000, wait.TimeoutMs);

        var fill = Assert.IsType<FillStep>(plan.Steps[2]);
        Assert.Equal("#user", fill.Selector);
        Assert.Equal("SF_USERNAME", fill.EnvironmentVariableName);

        var click = Assert.IsType<ClickStep>(plan.Steps[3]);
        Assert.Equal("#submit", click.Selector);

        var scroll = Assert.IsType<ScrollStep>(plan.Steps[4]);
        Assert.Equal("#list", scroll.ContainerSelector);
        Assert.Equal(".more", scroll.LoadMoreButtonSelector);
        Assert.Equal(4, scroll.MaxIterations);
        Assert.Equal(750, scroll.WaitAfterMs);

        Assert.IsType<ExtractStep>(plan.Steps[5]);
    }

    [Fact]
    public void Build_NoBrowserActions_ProducesNoActionSteps()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
        };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Equal(2, plan.Steps.Count);
    }

    [Fact]
    public void Build_BrowserActions_AlsoRunBeforeGroupExtraction()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Engine = ScrapingEngine.Browser,
            Groups = SampleGroups(),
            BrowserActions = [new ClickAction { Selector = "#cookie-consent" }],
        };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Equal(3, plan.Steps.Count);
        Assert.IsType<NavigateStep>(plan.Steps[0]);
        Assert.IsType<ClickStep>(plan.Steps[1]);
        Assert.IsType<ExtractGroupStep>(plan.Steps[2]);
    }

    private static ApiConfig SampleApiConfig() => new()
    {
        UrlTemplate = "https://example.com/api/items?category={category}",
        ItemsPath = "data.items",
        Fields = [new ApiField { Name = "Titel", Path = "title" }],
        Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a", "b"] } }],
    };

    [Fact]
    public void Build_Api_ProducesNavigateStepFollowedByOneApiCallStep()
    {
        var config = new ScrapingConfig { Url = "https://example.com", Api = SampleApiConfig() };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Equal(2, plan.Steps.Count);
        Assert.IsType<NavigateStep>(plan.Steps[0]);
        var apiStep = Assert.IsType<ApiCallStep>(plan.Steps[1]);
        Assert.Same(config.Api, apiStep.Config);
    }

    [Fact]
    public void Build_Api_ForcesCsvOutputFormatAndApiEngineRegardlessOfConfig()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Api = SampleApiConfig(),
            OutputFormat = OutputFormat.Xml,
            Engine = ScrapingEngine.Browser,
        };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Equal(OutputFormat.Csv, plan.OutputFormat);
        Assert.Equal(ScrapingEngine.Api, plan.Engine);
    }

    [Fact]
    public void Build_ApiWithFlatShape_WithJsonOutputFormat_KeepsJsonInsteadOfCsv()
    {
        var config = new ScrapingConfig { Url = "https://example.com", Api = SampleApiConfig(), OutputFormat = OutputFormat.Json };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Equal(OutputFormat.Json, plan.OutputFormat);
    }

    [Fact]
    public void Build_Api_AlsoSanitizesFileNames()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com", Api = SampleApiConfig(),
            ScriptFileName = "", OutputFileName = "***",
        };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Equal("scraper", plan.ScriptFileName);
        Assert.Equal("output", plan.OutputFileBaseName);
    }

    // ── API-Mode: Groups (tree shape, Issue #54) ────────────────────────

    private static ApiConfig SampleApiGroupsConfig() => new()
    {
        UrlTemplate = "https://example.com/api/catalog?category={category}",
        Groups =
        [
            new ApiGroup
            {
                Name = "Kategorie", Path = "categories",
                Children = [new ApiField { Name = "Titel", Path = "name" }],
            },
        ],
        Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a", "b"] } }],
    };

    [Fact]
    public void Build_ApiWithGroups_ForcesXmlOutputFormatInsteadOfCsv()
    {
        var config = new ScrapingConfig { Url = "https://example.com", Api = SampleApiGroupsConfig(), OutputFormat = OutputFormat.Csv };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Equal(OutputFormat.Xml, plan.OutputFormat);
        Assert.Equal(ScrapingEngine.Api, plan.Engine);
    }

    [Fact]
    public void Build_ApiWithFlatShape_StillForcesCsvOutputFormat()
    {
        // SampleApiConfig() (flat ItemsPath/Fields, no Groups) must keep
        // forcing Csv exactly as before Issue #54 — only the Groups shape
        // changes the forced OutputFormat.
        var config = new ScrapingConfig { Url = "https://example.com", Api = SampleApiConfig(), OutputFormat = OutputFormat.Xml };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Equal(OutputFormat.Csv, plan.OutputFormat);
    }

    [Fact]
    public void Build_ApiWithGroups_WithJsonOutputFormat_KeepsJsonInsteadOfXml()
    {
        var config = new ScrapingConfig { Url = "https://example.com", Api = SampleApiGroupsConfig(), OutputFormat = OutputFormat.Json };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Equal(OutputFormat.Json, plan.OutputFormat);
    }

    // Issue #87
    [Fact]
    public void Build_CarriesChangeDetectionThroughUnchanged_FlatMode()
    {
        var changeDetection = new ChangeDetectionConfig { Notify = "Webhook", Webhook = new WebhookNotificationConfig { UrlEnvVar = "SF_WEBHOOK_URL" } };
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
            ChangeDetection = changeDetection,
        };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Same(changeDetection, plan.ChangeDetection);
    }

    [Fact]
    public void Build_CarriesChangeDetectionThroughUnchanged_ContainerMode()
    {
        var changeDetection = new ChangeDetectionConfig { Notify = "Webhook", Webhook = new WebhookNotificationConfig { UrlEnvVar = "SF_WEBHOOK_URL" } };
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Groups = [new GroupNode { Name = "Kategorie", Selector = "section", Repeating = true, Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }] }],
            ChangeDetection = changeDetection,
        };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Same(changeDetection, plan.ChangeDetection);
    }

    [Fact]
    public void Build_CarriesChangeDetectionThroughUnchanged_ApiMode()
    {
        var changeDetection = new ChangeDetectionConfig { Notify = "Webhook", Webhook = new WebhookNotificationConfig { UrlEnvVar = "SF_WEBHOOK_URL" } };
        var config = new ScrapingConfig { Url = "https://example.com", Api = SampleApiGroupsConfig(), ChangeDetection = changeDetection };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Same(changeDetection, plan.ChangeDetection);
    }

    [Fact]
    public void Build_NoChangeDetection_PlanChangeDetectionIsNull()
    {
        var config = new ScrapingConfig { Url = "https://example.com", Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }] };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Null(plan.ChangeDetection);
    }

    // Issue #88
    [Fact]
    public void Build_CarriesProxyThroughUnchanged_FlatMode()
    {
        var proxy = new ProxyConfig { EnvironmentVariableName = "SF_PROXIES" };
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
            Proxy = proxy,
        };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Same(proxy, plan.Proxy);
    }

    [Fact]
    public void Build_CarriesProxyThroughUnchanged_ContainerMode()
    {
        var proxy = new ProxyConfig { EnvironmentVariableName = "SF_PROXIES" };
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Groups = [new GroupNode { Name = "Kategorie", Selector = "section", Repeating = true, Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }] }],
            Proxy = proxy,
        };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Same(proxy, plan.Proxy);
    }

    [Fact]
    public void Build_CarriesProxyThroughUnchanged_ApiMode()
    {
        var proxy = new ProxyConfig { EnvironmentVariableName = "SF_PROXIES" };
        var config = new ScrapingConfig { Url = "https://example.com", Api = SampleApiGroupsConfig(), Proxy = proxy };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Same(proxy, plan.Proxy);
    }

    [Fact]
    public void Build_NoProxy_PlanProxyIsNull()
    {
        var config = new ScrapingConfig { Url = "https://example.com", Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }] };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Null(plan.Proxy);
    }

    // Issue #175
    [Fact]
    public void Build_CarriesPersistentSessionThroughUnchanged_FlatMode()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
            Engine = ScrapingEngine.Browser,
            PersistentSession = true,
        };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.True(plan.PersistentSession);
    }

    [Fact]
    public void Build_CarriesPersistentSessionThroughUnchanged_ContainerMode()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Groups = [new GroupNode { Name = "Kategorie", Selector = "section", Repeating = true, Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }] }],
            Engine = ScrapingEngine.Browser,
            PersistentSession = true,
        };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.True(plan.PersistentSession);
    }

    [Fact]
    public void Build_NoPersistentSession_PlanPersistentSessionIsFalse()
    {
        var config = new ScrapingConfig { Url = "https://example.com", Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }] };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.False(plan.PersistentSession);
    }

    // Issue #129
    [Fact]
    public void Build_CarriesHardeningThroughUnchanged_FlatMode()
    {
        var hardening = new List<HardeningCheck> { new NoResultCheck { Severity = HardeningSeverity.Error } };
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
            Hardening = hardening,
        };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Same(hardening, plan.Hardening);
    }

    [Fact]
    public void Build_CarriesHardeningThroughUnchanged_ContainerMode()
    {
        var hardening = new List<HardeningCheck> { new NoResultCheck { Severity = HardeningSeverity.Warning } };
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Groups = [new GroupNode { Name = "Kategorie", Selector = "section", Repeating = true, Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }] }],
            Hardening = hardening,
        };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Same(hardening, plan.Hardening);
    }

    [Fact]
    public void Build_CarriesHardeningThroughUnchanged_ApiMode()
    {
        var hardening = new List<HardeningCheck> { new NoResultCheck { Severity = HardeningSeverity.Error } };
        var config = new ScrapingConfig { Url = "https://example.com", Api = SampleApiGroupsConfig(), Hardening = hardening };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Same(hardening, plan.Hardening);
    }

    [Fact]
    public void Build_NoHardening_PlanHardeningIsNull()
    {
        var config = new ScrapingConfig { Url = "https://example.com", Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }] };

        var plan = ScrapingPlanBuilder.Build(config);

        Assert.Null(plan.Hardening);
    }
}
