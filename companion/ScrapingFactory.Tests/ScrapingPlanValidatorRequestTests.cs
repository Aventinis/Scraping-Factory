using ScrapingFactory.Compiler.IR;
using Xunit;
using static ScrapingFactory.Tests.ValidatorTestPlans;

namespace ScrapingFactory.Tests;

// Request headers and the :contains() text filter. (ScrapingPlanValidator; the plan builders are in ValidatorTestPlans.)
public class ScrapingPlanValidatorRequestTests
{
    [Fact]
    public void Validate_RequestHeaders_LiteralAndEnvironmentVariable_Succeed()
    {
        var result = ScrapingPlanValidator.Validate(PlanWithHeaders(
            new ApiHeader { Name = "Accept-Language", Value = "de-CH" },
            new ApiHeader { Name = "X-Api-Key", EnvironmentVariableName = "SF_API_KEY" }));

        Assert.True(result.Success, result.Error);
    }

    [Theory]
    [InlineData("")]
    [InlineData("Bad Name")]
    [InlineData("Bad:Name")]
    [InlineData("Ümlaut")]
    public void Validate_RequestHeaders_InvalidName_Fails(string name)
    {
        var result = ScrapingPlanValidator.Validate(PlanWithHeaders(new ApiHeader { Name = name, Value = "x" }));

        Assert.False(result.Success);
        Assert.Contains("request header", result.Error);
    }

    [Fact]
    public void Validate_RequestHeaders_NeedsExactlyOneOfValueAndEnvironmentVariable()
    {
        Assert.Contains("exactly one", ScrapingPlanValidator.Validate(PlanWithHeaders(new ApiHeader { Name = "X-A" })).Error);
        Assert.Contains("exactly one", ScrapingPlanValidator.Validate(PlanWithHeaders(new ApiHeader { Name = "X-A", Value = "v", EnvironmentVariableName = "SF_A" })).Error);
    }

    [Fact]
    public void Validate_RequestHeaders_TemplateIsRejected()
    {
        var result = ScrapingPlanValidator.Validate(PlanWithHeaders(new ApiHeader { Name = "Authorization", Template = "Bearer {token}" }));

        Assert.False(result.Success);
        Assert.Contains("template", result.Error);
    }

    [Fact]
    public void Validate_RequestHeaders_LineBreakInValue_Fails()
    {
        var result = ScrapingPlanValidator.Validate(PlanWithHeaders(new ApiHeader { Name = "X-A", Value = "ok\r\nX-Injected: 1" }));

        Assert.False(result.Success);
        Assert.Contains("line break", result.Error);
    }

    [Fact]
    public void Validate_RequestHeaders_InvalidEnvironmentVariableName_Fails()
    {
        var result = ScrapingPlanValidator.Validate(PlanWithHeaders(new ApiHeader { Name = "X-A", EnvironmentVariableName = "1BAD-NAME" }));

        Assert.False(result.Success);
        Assert.Contains("environment variable", result.Error);
    }

    [Fact]
    public void Validate_RequestHeaders_DuplicateNameIgnoringCase_Fails()
    {
        var result = ScrapingPlanValidator.Validate(PlanWithHeaders(
            new ApiHeader { Name = "Accept-Language", Value = "de" },
            new ApiHeader { Name = "accept-language", Value = "en" }));

        Assert.False(result.Success);
        Assert.Contains("Duplicate request header", result.Error);
    }

    // ---- Issue #227: :contains("text") selector suffix ---------------------

    [Fact]
    public void Validate_TextFilter_ValidOnFlatFieldGroupAndDataField()
    {
        Assert.True(ScrapingPlanValidator.Validate(FlatPlanWithSelector(".btn:contains(\"Merken\")")).Success);

        var groups = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractGroupStep
                {
                    Roots =
                    [
                        new GroupNode
                        {
                            Name = "G", Selector = ".card:contains(\"Angebot\")", Repeating = true,
                            Children = [new DataFieldNode { Name = "N", Selector = "a:contains('Mehr')" }],
                        },
                    ],
                },
            ],
            OutputFormat = OutputFormat.Xml,
        };
        Assert.True(ScrapingPlanValidator.Validate(groups).Success);
    }

    [Theory]
    [InlineData("a:contains(x)")]
    [InlineData("a:contains(\"x\") b")]
    public void Validate_TextFilter_MalformedOnFlatField_FailsNamingTheField(string selector)
    {
        var result = ScrapingPlanValidator.Validate(FlatPlanWithSelector(selector));

        Assert.False(result.Success);
        Assert.Contains("Selector for field 'F'", result.Error);
    }

    [Fact]
    public void Validate_TextFilter_MalformedOnGroupAndDataField_Fails()
    {
        ScrapingPlan Plan(string groupSelector, string fieldSelector) => new()
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractGroupStep
                {
                    Roots = [new GroupNode { Name = "G", Selector = groupSelector, Repeating = true, Children = [new DataFieldNode { Name = "N", Selector = fieldSelector }] }],
                },
            ],
            OutputFormat = OutputFormat.Xml,
        };

        Assert.Contains("group 'G'", ScrapingPlanValidator.Validate(Plan("div:contains(x)", "a")).Error);
        Assert.Contains("data field 'N'", ScrapingPlanValidator.Validate(Plan("div", "a:contains(x)")).Error);
    }

    [Fact]
    public void Validate_TextFilter_PaginationAndDiscoveredLinkSelectors()
    {
        var ok = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ExtractStep { Name = "F", Selector = "h1" }],
            Pagination = new NextLinkPagination { NextLinkSelector = "a:contains(\"Weiter\")" },
            DiscoveredUrls = new DiscoveredUrlsConfig { PageUrl = "https://example.com/nav", LinkSelector = "a:contains(\"Kategorie\")" },
        };
        Assert.True(ScrapingPlanValidator.Validate(ok).Success);

        var badNext = new ScrapingPlan { Steps = ok.Steps, Pagination = new NextLinkPagination { NextLinkSelector = "a:contains(Weiter)" } };
        Assert.Contains("NextLinkPagination.NextLinkSelector", ScrapingPlanValidator.Validate(badNext).Error);

        var badDiscovered = new ScrapingPlan { Steps = ok.Steps, DiscoveredUrls = new DiscoveredUrlsConfig { PageUrl = "https://example.com/nav", LinkSelector = "a:contains(x)" } };
        Assert.Contains("DiscoveredUrls.LinkSelector", ScrapingPlanValidator.Validate(badDiscovered).Error);
    }

    [Fact]
    public void Validate_TextFilter_BrowserActionSelectors()
    {
        ScrapingPlan Plan(string clickSelector, string? loadMore = null) => new()
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ClickStep { Selector = clickSelector },
                new ScrollStep { LoadMoreButtonSelector = loadMore },
                new ExtractStep { Name = "F", Selector = "h1" },
            ],
        };

        Assert.True(ScrapingPlanValidator.Validate(Plan("button:contains(\"In den Warenkorb\")", "button:contains('Mehr laden')")).Success);
        Assert.Contains("ClickStep", ScrapingPlanValidator.Validate(Plan("button:contains(x)")).Error);
        Assert.Contains("LoadMoreButtonSelector", ScrapingPlanValidator.Validate(Plan("button", "button:contains(x)")).Error);
    }

    [Fact]
    public void Validate_TextFilter_IsRejectedInFramePathsAndTheEmbeddedScriptSelector()
    {
        var framed = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = "F", Selector = "h1", FramePath = ["iframe:contains(\"x\")"] },
            ],
        };
        var frameResult = ScrapingPlanValidator.Validate(framed);
        Assert.False(frameResult.Success);
        Assert.Contains("not supported here", frameResult.Error);

        var api = new ApiConfig
        {
            UrlTemplate = "https://example.com/page",
            EmbeddedJsonSource = new EmbeddedJsonSource { ScriptSelector = "script:contains(\"state\")" },
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Id", Path = "id" }],
        };
        var apiPlan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
            Engine = ScrapingEngine.Api,
        };
        var apiResult = ScrapingPlanValidator.Validate(apiPlan);
        Assert.False(apiResult.Success);
        Assert.Contains("EmbeddedJsonSource.ScriptSelector", apiResult.Error);
    }
}
