using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class ScrapingPlanBuilderTests
{
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
}
