using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class PythonApiCodeGeneratorTests
{
    private readonly PythonApiCodeGenerator _generator = new();

    private static ScrapingPlan PlanWith(ApiConfig api) => new()
    {
        Steps = [new NavigateStep { Url = "https://example.com" }, new ApiCallStep { Config = api }],
        OutputFormat = OutputFormat.Csv,
        Engine = ScrapingEngine.Api,
    };

    private static ApiConfig SampleApi() => new()
    {
        UrlTemplate = "https://example.com/api/items?category={category}",
        ItemsPath = "data.items",
        Fields = [new ApiField { Name = "Titel", Path = "title" }, new ApiField { Name = "Preis", Path = "meta.price" }],
        Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a", "b"] } }],
    };

    [Fact]
    public void Generate_ContainsUrlTemplateAndItemsPath()
    {
        var script = _generator.Generate(PlanWith(SampleApi()));
        Assert.Contains("https://example.com/api/items?category={category}", script);
        Assert.Contains("data.items", script);
    }

    [Fact]
    public void Generate_ContainsAllFieldNamesAndPaths()
    {
        var script = _generator.Generate(PlanWith(SampleApi()));
        Assert.Contains("Titel", script);
        Assert.Contains("'title'", script);
        Assert.Contains("Preis", script);
        Assert.Contains("meta.price", script);
    }

    [Fact]
    public void Generate_StaticListParameter_ContainsValuesInParametersLiteral()
    {
        var script = _generator.Generate(PlanWith(SampleApi()));
        Assert.Contains("\"kind\": \"staticList\"", script);
        Assert.Contains("'a'", script);
        Assert.Contains("'b'", script);
    }

    [Fact]
    public void Generate_ContainsRequestsButNotBeautifulSoup()
    {
        var script = _generator.Generate(PlanWith(SampleApi()));
        Assert.Contains("import requests", script);
        Assert.DoesNotContain("BeautifulSoup", script);
        Assert.DoesNotContain("bs4", script);
    }

    [Fact]
    public void Generate_ContainsItertoolsProductAndCsvDictWriter()
    {
        var script = _generator.Generate(PlanWith(SampleApi()));
        Assert.Contains("import itertools", script);
        Assert.Contains("itertools.product", script);
        Assert.Contains("csv.DictWriter", script);
    }

    [Fact]
    public void Generate_DefaultsToScraperAndOutputFileNames()
    {
        var script = _generator.Generate(PlanWith(SampleApi()));
        Assert.Contains("python scraper.py", script);
        Assert.Contains("open(\"output.csv\"", script);
    }

    [Fact]
    public void Generate_UsesConfiguredFileNames()
    {
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Url = "https://example.com" }, new ApiCallStep { Config = SampleApi() }],
            OutputFormat = OutputFormat.Csv,
            Engine = ScrapingEngine.Api,
            ScriptFileName = "api_scraper",
            OutputFileBaseName = "api_results",
        };

        var script = _generator.Generate(plan);

        Assert.Contains("python api_scraper.py", script);
        Assert.Contains("open(\"api_results.csv\"", script);
        Assert.DoesNotContain("output.csv", script);
    }

    [Fact]
    public void Generate_DiscoverySourceParameter_ContainsDiscoveryFields()
    {
        var api = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?category={category}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters =
            [
                new ApiParameter
                {
                    Name = "category",
                    Source = new DiscoverySource
                    {
                        UrlTemplate = "https://example.com/api/categories",
                        ItemsPath = "data",
                        ValuePath = "slug",
                    },
                },
            ],
        };

        var script = _generator.Generate(PlanWith(api));

        Assert.Contains("\"kind\": \"discovery\"", script);
        Assert.Contains("https://example.com/api/categories", script);
        Assert.Contains("'slug'", script);
    }

    [Fact]
    public void Generate_RangeSourceParameter_ContainsRangeFields()
    {
        var api = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?week={week}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "week", Source = new RangeSource { Type = RangeType.IsoWeek, From = "2026-W01", To = "today" } }],
        };

        var script = _generator.Generate(PlanWith(api));

        Assert.Contains("\"kind\": \"range\"", script);
        Assert.Contains("'IsoWeek'", script);
        Assert.Contains("'2026-W01'", script);
        Assert.Contains("'today'", script);
        // Not "format" alone — that also appears in the template's own
        // dispatch code (`source.get("format", ...)`) regardless of this
        // RangeSource. The dict-literal key specifically ends in a colon.
        Assert.DoesNotContain("\"format\":", script);
    }

    [Fact]
    public void Generate_RangeSourceParameterWithFormat_ContainsFormatLiteral()
    {
        var api = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?week={week}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "week", Source = new RangeSource { Type = RangeType.IsoWeek, From = "2026-35", To = "2026-50", Format = "{yyyy}-{ww}" } }],
        };

        var script = _generator.Generate(PlanWith(api));

        Assert.Contains("\"format\":", script);
        Assert.Contains("'{yyyy}-{ww}'", script);
    }

    [Fact]
    public void Generate_HeaderWithValue_ContainsLiteralValueNotEnvironmentLookup()
    {
        var api = SampleApi();
        var withHeader = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath, Fields = api.Fields, Parameters = api.Parameters,
            Headers = [new ApiHeader { Name = "Accept", Value = "application/json" }],
        };

        var script = _generator.Generate(PlanWith(withHeader));

        Assert.Contains("'Accept'", script);
        Assert.Contains("application/json", script);
        Assert.DoesNotContain("import os", script);
    }

    [Fact]
    public void Generate_HeaderWithEnvironmentVariable_NeverEmbedsLiteralValueAndImportsOs()
    {
        var api = SampleApi();
        var withHeader = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath, Fields = api.Fields, Parameters = api.Parameters,
            Headers = [new ApiHeader { Name = "Authorization", EnvironmentVariableName = "SF_TOKEN" }],
        };

        var script = _generator.Generate(PlanWith(withHeader));

        Assert.Contains("import os", script);
        Assert.Contains("os.environ[header[\"envVar\"]]", script);
        Assert.Contains("'SF_TOKEN'", script);
    }

    // Mirrors ScrapingPlanValidator.ValidateApiHeaders's "meaningful" check:
    // an empty-string (not null) EnvironmentVariableName alongside a set
    // Value is a legally reachable state (validator sees Value as the one
    // set field), so codegen must treat it as a literal header, not attempt
    // an os.environ[''] lookup at runtime.
    [Fact]
    public void Generate_HeaderWithValueAndEmptyEnvironmentVariableName_UsesLiteralValue()
    {
        var api = SampleApi();
        var withHeader = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath, Fields = api.Fields, Parameters = api.Parameters,
            Headers = [new ApiHeader { Name = "Accept", Value = "application/json", EnvironmentVariableName = "" }],
        };

        var script = _generator.Generate(PlanWith(withHeader));

        Assert.Contains("\"value\": 'application/json'", script);
        // "envVar" (no colon) still appears in the always-present
        // _build_headers() boilerplate (header["envVar"]) — only the
        // HEADERS literal entry itself ("envVar": ...) must be absent.
        Assert.DoesNotContain("\"envVar\":", script);
        Assert.DoesNotContain("import os", script);
    }

    [Fact]
    public void Generate_NoHeaders_DoesNotImportOs()
    {
        var script = _generator.Generate(PlanWith(SampleApi()));
        Assert.DoesNotContain("import os", script);
    }
}
