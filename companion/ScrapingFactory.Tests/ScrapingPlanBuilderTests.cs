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
}
