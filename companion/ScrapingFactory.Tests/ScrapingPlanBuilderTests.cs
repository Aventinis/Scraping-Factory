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
        Assert.Equal("https://example.com", navigate.Url);

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
}
