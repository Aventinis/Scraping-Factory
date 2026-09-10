using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class PythonApiCodeGeneratorTests
{
    private readonly PythonApiCodeGenerator _generator = new();

    private static ScrapingPlan PlanWith(ApiConfig api) => new()
    {
        Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
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

    // Many sites reject the bare "python-requests/x.y" default User-Agent
    // with 403 Forbidden — see PythonScriptVerifierTests for a real
    // end-to-end reproduction/fix proof.
    [Fact]
    public void Generate_BuildHeaders_SetsDefaultUserAgentFirst()
    {
        var script = _generator.Generate(PlanWith(SampleApi()));
        Assert.Contains("headers = {\"User-Agent\":", script);
    }

    [Fact]
    public void Generate_FieldWithTransforms_RendersTransformChainAndRuntimeHelper()
    {
        var api = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Preis", Path = "price", Transforms = [new TrimTransform(), new ToNumberTransform()] }],
        };

        var script = _generator.Generate(PlanWith(api));
        Assert.Contains("""{"kind": "trim"}""", script);
        Assert.Contains("""{"kind": "toNumber"}""", script);
        Assert.Contains("def _apply_transforms(value, transforms):", script);
        Assert.Contains("_apply_transforms(str(value), field[\"transform\"])", script);
    }

    [Fact]
    public void Generate_FieldWithoutTransforms_HasEmptyTransformKeyInFieldLiteral()
    {
        var script = _generator.Generate(PlanWith(SampleApi()));
        Assert.Contains("\"transform\": []", script);
    }

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
        Assert.Contains("OUTPUT_PATH = \"output.csv\"", script);
    }

    [Fact]
    public void Generate_UsesConfiguredFileNames()
    {
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = SampleApi() }],
            OutputFormat = OutputFormat.Csv,
            Engine = ScrapingEngine.Api,
            ScriptFileName = "api_scraper",
            OutputFileBaseName = "api_results",
        };

        var script = _generator.Generate(plan);

        Assert.Contains("python api_scraper.py", script);
        Assert.Contains("OUTPUT_PATH = \"api_results.csv\"", script);
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

    // ── Proxy support (Issue #88) ─────────────────────────────────────────

    [Fact]
    public void Generate_NoProxy_DoesNotContainProxyEnvVar()
    {
        var script = _generator.Generate(PlanWith(SampleApi()));
        Assert.DoesNotContain("PROXY_ENV_VAR", script);
        Assert.Contains("requests.get(url, headers=headers, timeout=10)", script);
    }

    [Fact]
    public void Generate_WithProxy_ReadsListFromEnvironmentVariableAndWiresIntoMainRequest()
    {
        var plan = PlanWith(SampleApi());
        plan = new ScrapingPlan
        {
            Steps = plan.Steps, OutputFormat = plan.OutputFormat, Engine = plan.Engine,
            Proxy = new ProxyConfig { EnvironmentVariableName = "SF_PROXIES" },
        };

        var script = _generator.Generate(plan);

        Assert.Contains("import os", script);
        Assert.Contains("PROXY_ENV_VAR = 'SF_PROXIES'", script);
        Assert.Contains("os.environ[PROXY_ENV_VAR]", script);
        Assert.Contains("itertools.cycle(_PROXY_LIST)", script);
        Assert.Contains("requests.get(url, headers=headers, proxies=_proxies_for_requests(), timeout=10)", script);
    }

    [Fact]
    public void Generate_WithProxy_WiresIntoDiscoverySourceRequest()
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
        var plan = PlanWith(api);
        plan = new ScrapingPlan
        {
            Steps = plan.Steps, OutputFormat = plan.OutputFormat, Engine = plan.Engine,
            Proxy = new ProxyConfig { EnvironmentVariableName = "SF_PROXIES" },
        };

        var script = _generator.Generate(plan);

        Assert.Contains(
            "requests.get(source[\"urlTemplate\"], headers=headers, proxies=_proxies_for_requests(), timeout=10)",
            script);
    }

    [Fact]
    public void Generate_WithProxy_PostMethod_WiresProxiesIntoPostCall()
    {
        var withBody = new ApiConfig
        {
            Method = "POST",
            UrlTemplate = "https://example.com/api/items",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Body = new ApiBodyObject { Properties = new Dictionary<string, ApiBodyNode> { ["q"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.String, StringValue = "all" } } },
        };
        var plan = PlanWith(withBody);
        plan = new ScrapingPlan
        {
            Steps = plan.Steps, OutputFormat = plan.OutputFormat, Engine = plan.Engine,
            Proxy = new ProxyConfig { EnvironmentVariableName = "SF_PROXIES" },
        };

        var script = _generator.Generate(plan);

        Assert.Contains("requests.post(url, headers=headers, json=body, proxies=_proxies_for_requests(), timeout=10)", script);
    }

    // ── Groups (Issue #54's tree shape) ──────────────────────────────────
    // Picks scraper_api_grouped.py.j2 instead of scraper_api.py.j2 — same
    // "a second template, not an if-branch inside the flat one" precedent
    // Container-Mode already set for scraper.py.j2/scraper_grouped.py.j2.

    private static ApiConfig SampleGroupedApi() => new()
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
                    new ApiField { Name = "Name", Path = "name" },
                    new ApiGroup
                    {
                        Name = "Produkt",
                        Path = "products",
                        Children = [new ApiField { Name = "Titel", Path = "title" }],
                    },
                ],
            },
        ],
        Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["electronics"] } }],
    };

    [Fact]
    public void Generate_ApiConfigWithGroups_ContainsGroupsLiteralAndTreeWalker()
    {
        var script = _generator.Generate(PlanWith(SampleGroupedApi()));

        Assert.Contains("GROUPS = [", script);
        Assert.Contains("'Kategorie'", script);
        Assert.Contains("'categories'", script);
        Assert.Contains("'Produkt'", script);
        Assert.Contains("'products'", script);
        Assert.Contains("def _extract_api_group(", script);
        Assert.Contains("\"children\" in node", script);
    }

    // scraper_api_grouped.py.j2 has its own copy of _build_headers() (no
    // cross-template includes, see scraper_grouped.py.j2's own doc comment
    // on the same duplication) — proves the grouped template got the fix too.
    [Fact]
    public void Generate_ApiGroups_BuildHeaders_SetsDefaultUserAgentFirst()
    {
        var script = _generator.Generate(PlanWith(SampleGroupedApi()));
        Assert.Contains("headers = {\"User-Agent\":", script);
    }

    [Fact]
    public void Generate_ApiGroupsFieldWithTransforms_RendersTransformChainAndRuntimeHelper()
    {
        var api = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/catalog",
            Groups =
            [
                new ApiGroup
                {
                    Name = "Kategorie", Path = "categories",
                    Children = [new ApiField { Name = "Preis", Path = "price", Transforms = [new ToNumberTransform()] }],
                },
            ],
        };

        var script = _generator.Generate(PlanWith(api));
        Assert.Contains("""{"kind": "toNumber"}""", script);
        Assert.Contains("def _apply_transforms(value, transforms):", script);
        Assert.Contains("_apply_transforms(str(value), node[\"transform\"])", script);
    }

    [Fact]
    public void Generate_ApiConfigWithGroups_WritesXmlNotCsv()
    {
        var script = _generator.Generate(PlanWith(SampleGroupedApi()));

        Assert.Contains("import xml.etree.ElementTree as ET", script);
        Assert.Contains("OUTPUT_PATH = \"output.xml\"", script);
        Assert.DoesNotContain("import csv", script);
        Assert.DoesNotContain("ITEMS_PATH", script);
        Assert.DoesNotContain("FIELDS = ", script);
    }

    [Fact]
    public void Generate_ApiConfigWithGroups_DoesNotImportBeautifulSoup()
    {
        var script = _generator.Generate(PlanWith(SampleGroupedApi()));

        Assert.DoesNotContain("BeautifulSoup", script);
        Assert.DoesNotContain("bs4", script);
    }

    [Fact]
    public void Generate_ApiConfigWithGroups_UsesConfiguredFileNames()
    {
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = SampleGroupedApi() }],
            OutputFormat = OutputFormat.Xml,
            Engine = ScrapingEngine.Api,
            ScriptFileName = "api_scraper",
            OutputFileBaseName = "api_results",
        };

        var script = _generator.Generate(plan);

        Assert.Contains("python api_scraper.py", script);
        Assert.Contains("OUTPUT_PATH = \"api_results.xml\"", script);
        Assert.DoesNotContain("output.xml", script);
    }

    [Fact]
    public void Generate_ApiConfigWithGroups_StaticListParameter_ContainsValuesInParametersLiteral()
    {
        var script = _generator.Generate(PlanWith(SampleGroupedApi()));

        Assert.Contains("\"kind\": \"staticList\"", script);
        Assert.Contains("'electronics'", script);
    }

    [Fact]
    public void Generate_ApiConfigWithGroups_HeaderWithEnvironmentVariable_ImportsOs()
    {
        var api = SampleGroupedApi();
        var withHeader = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate, Groups = api.Groups, Parameters = api.Parameters,
            Headers = [new ApiHeader { Name = "Authorization", EnvironmentVariableName = "SF_TOKEN" }],
        };

        var script = _generator.Generate(PlanWith(withHeader));

        Assert.Contains("import os", script);
        Assert.Contains("'SF_TOKEN'", script);
    }

    [Fact]
    public void Generate_ApiConfigWithGroups_NoHeaders_DoesNotImportOs()
    {
        var script = _generator.Generate(PlanWith(SampleGroupedApi()));
        Assert.DoesNotContain("import os", script);
    }

    // ── Request body (Issue #55) ────────────────────────────────────────

    [Fact]
    public void Generate_DefaultsToGetMethodAndNoBody()
    {
        var script = _generator.Generate(PlanWith(SampleApi()));
        Assert.Contains("METHOD = 'GET'", script);
        Assert.Contains("BODY = None", script);
    }

    [Fact]
    public void Generate_PostMethodWithLiteralBody_ContainsPostCallAndBodyLiteral()
    {
        var api = SampleApi();
        var withBody = new ApiConfig
        {
            Method = "POST", UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath,
            Fields = api.Fields, Parameters = api.Parameters,
            Body = new ApiBodyObject { Properties = new Dictionary<string, ApiBodyNode> { ["active"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.Boolean, BoolValue = true } } },
        };

        var script = _generator.Generate(PlanWith(withBody));

        Assert.Contains("METHOD = 'POST'", script);
        Assert.Contains("requests.post(url, headers=headers, json=body, timeout=10)", script);
        Assert.Contains("\"kind\": \"Boolean\", \"value\": True", script);
    }

    [Fact]
    public void Generate_BodyWithVariable_ContainsParameterNameAndCoerceTo()
    {
        var api = SampleApi();
        var withBody = new ApiConfig
        {
            Method = "POST", UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath,
            Fields = api.Fields, Parameters = api.Parameters,
            Body = new ApiBodyObject { Properties = new Dictionary<string, ApiBodyNode> { ["category"] = new ApiBodyVariable { ParameterName = "category", CoerceTo = ApiBodyLiteralKind.Number } } },
        };

        var script = _generator.Generate(PlanWith(withBody));

        Assert.Contains("\"parameterName\": 'category'", script);
        Assert.Contains("\"coerceTo\": 'Number'", script);
        Assert.Contains("def _coerce_body_value(", script);
        Assert.Contains("def _render_body(", script);
    }

    [Fact]
    public void Generate_NullLiteralBody_OmitsValueKey()
    {
        var api = SampleApi();
        var withBody = new ApiConfig
        {
            Method = "POST", UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath,
            Fields = api.Fields, Parameters = api.Parameters,
            Body = new ApiBodyObject { Properties = new Dictionary<string, ApiBodyNode> { ["optional"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.Null } } },
        };

        var script = _generator.Generate(PlanWith(withBody));

        Assert.Contains("\"kind\": \"Null\"}", script);
        Assert.DoesNotContain("\"kind\": \"Null\", \"value\"", script);
    }

    // Concretizes the case that actually motivated a typed body tree: a
    // GraphQL body is just an ordinary ApiBodyObject with a fixed "query"
    // string and a nested "variables" object — no dedicated GraphQL concept
    // anywhere in codegen either.
    [Fact]
    public void Generate_GraphQlShapedBody_ContainsNestedPropertiesAndVariable()
    {
        var api = SampleApi();
        var withBody = new ApiConfig
        {
            Method = "POST", UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath,
            Fields = api.Fields, Parameters = api.Parameters,
            Body = new ApiBodyObject
            {
                Properties = new Dictionary<string, ApiBodyNode>
                {
                    ["query"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.String, StringValue = "query { items }" },
                    ["variables"] = new ApiBodyObject
                    {
                        Properties = new Dictionary<string, ApiBodyNode> { ["category"] = new ApiBodyVariable { ParameterName = "category" } },
                    },
                },
            },
        };

        var script = _generator.Generate(PlanWith(withBody));

        Assert.Contains("'query { items }'", script);
        Assert.Contains("\"parameterName\": 'category'", script);
        // Two "properties" dicts — the outer body object and the nested
        // "variables" object.
        Assert.Equal(2, System.Text.RegularExpressions.Regex.Matches(script, "\"properties\":").Count);
    }

    [Fact]
    public void Generate_ApiConfigWithGroups_PostMethodWithBody_ContainsPostCall()
    {
        var api = SampleGroupedApi();
        var withBody = new ApiConfig
        {
            Method = "POST", UrlTemplate = api.UrlTemplate, Groups = api.Groups, Parameters = api.Parameters,
            Body = new ApiBodyObject { Properties = new Dictionary<string, ApiBodyNode> { ["category"] = new ApiBodyVariable { ParameterName = "category" } } },
        };

        var script = _generator.Generate(PlanWith(withBody));

        Assert.Contains("METHOD = 'POST'", script);
        Assert.Contains("requests.post(url, headers=headers, json=body, timeout=10)", script);
        Assert.Contains("\"parameterName\": 'category'", script);
    }

    // Issue #88
    [Fact]
    public void Generate_ApiConfigWithGroups_WithProxy_WiresIntoRequest()
    {
        var plan = PlanWith(SampleGroupedApi());
        plan = new ScrapingPlan
        {
            Steps = plan.Steps, OutputFormat = plan.OutputFormat, Engine = plan.Engine,
            Proxy = new ProxyConfig { EnvironmentVariableName = "SF_PROXIES" },
        };

        var script = _generator.Generate(plan);

        Assert.Contains("import os", script);
        Assert.Contains("PROXY_ENV_VAR = 'SF_PROXIES'", script);
        Assert.Contains("requests.get(url, headers=headers, proxies=_proxies_for_requests(), timeout=10)", script);
    }
}
