using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class ScrapingPlanValidatorTests
{
    private static ScrapingPlan ValidPlan() => new()
    {
        Steps =
        [
            new NavigateStep { Url = "https://example.com" },
            new ExtractStep { Name = "Titel", Selector = "h1" },
        ],
    };

    [Fact]
    public void Validate_ValidPlan_Succeeds()
    {
        var result = ScrapingPlanValidator.Validate(ValidPlan());
        Assert.True(result.Success);
        Assert.Null(result.Error);
    }

    [Fact]
    public void Validate_NoSteps_Fails()
    {
        var result = ScrapingPlanValidator.Validate(new ScrapingPlan());
        Assert.False(result.Success);
        Assert.Contains("NavigateStep", result.Error);
    }

    [Fact]
    public void Validate_DoesNotStartWithNavigateStep_Fails()
    {
        var plan = new ScrapingPlan { Steps = [new ExtractStep { Name = "Titel", Selector = "h1" }] };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("NavigateStep", result.Error);
    }

    [Fact]
    public void Validate_MultipleNavigateSteps_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Url = "https://example.com" },
                new NavigateStep { Url = "https://example.org" },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("nur einen NavigateStep", result.Error);
    }

    [Theory]
    [InlineData("not-a-url")]
    [InlineData("ftp://example.com")]
    [InlineData("")]
    public void Validate_InvalidUrl_Fails(string url)
    {
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Url = url }, new ExtractStep { Name = "Titel", Selector = "h1" }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Ungültige URL", result.Error);
    }

    [Fact]
    public void Validate_NoExtractSteps_Fails()
    {
        var plan = new ScrapingPlan { Steps = [new NavigateStep { Url = "https://example.com" }] };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("ExtractStep", result.Error);
    }

    [Fact]
    public void Validate_EmptyFieldName_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Url = "https://example.com" }, new ExtractStep { Name = "  ", Selector = "h1" }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Feldname", result.Error);
    }

    [Fact]
    public void Validate_EmptySelector_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Url = "https://example.com" }, new ExtractStep { Name = "Titel", Selector = " " }],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Selector", result.Error);
    }

    [Fact]
    public void Validate_ValidWaitForStep_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Url = "https://example.com" },
                new WaitForStep { Selector = ".loaded", TimeoutMs = 3000 },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success);
    }

    [Fact]
    public void Validate_WaitForStepWithEmptySelector_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Url = "https://example.com" },
                new WaitForStep { Selector = " " },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("WaitForStep", result.Error);
    }

    [Fact]
    public void Validate_WaitForStepWithNonPositiveTimeout_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Url = "https://example.com" },
                new WaitForStep { Selector = ".loaded", TimeoutMs = 0 },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Timeout", result.Error);
    }

    [Fact]
    public void Validate_BrowserOnlyStepWithStaticEngine_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Static,
            Steps =
            [
                new NavigateStep { Url = "https://example.com" },
                new WaitForStep { Selector = ".loaded" },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Engine", result.Error);
    }

    [Fact]
    public void Validate_ValidFillAndClickSteps_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Url = "https://example.com/login" },
                new FillStep { Selector = "#user", EnvironmentVariableName = "SF_USERNAME" },
                new ClickStep { Selector = "#submit" },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success);
    }

    [Fact]
    public void Validate_FillStepWithEmptySelector_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Url = "https://example.com" },
                new FillStep { Selector = " ", EnvironmentVariableName = "SF_USERNAME" },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("FillStep", result.Error);
    }

    [Theory]
    [InlineData("")]
    [InlineData("1BAD")]
    [InlineData("BAD NAME")]
    [InlineData("BAD-NAME")]
    public void Validate_FillStepWithInvalidEnvironmentVariableName_Fails(string envVarName)
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Url = "https://example.com" },
                new FillStep { Selector = "#user", EnvironmentVariableName = envVarName },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Umgebungsvariablen-Name", result.Error);
    }

    [Fact]
    public void Validate_ClickStepWithEmptySelector_Fails()
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Url = "https://example.com" },
                new ClickStep { Selector = " " },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("ClickStep", result.Error);
    }

    [Fact]
    public void Validate_DuplicateFieldNames_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Url = "https://example.com" },
                new ExtractStep { Name = "Titel", Selector = "h1" },
                new ExtractStep { Name = "Titel", Selector = "h2" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Doppelte Feldnamen", result.Error);
        Assert.Contains("Titel", result.Error);
    }

    // ── Container-Mode (ExtractGroupStep) ────────────────────────────────

    private static ScrapingPlan GroupPlan(List<GroupNode> roots, ScrapingEngine engine = ScrapingEngine.Static) => new()
    {
        Engine = engine,
        Steps = [new NavigateStep { Url = "https://example.com" }, new ExtractGroupStep { Roots = roots }],
    };

    [Fact]
    public void Validate_ValidNestedGroupTree_Succeeds()
    {
        var roots = new List<GroupNode>
        {
            new()
            {
                Name = "Kategorie",
                Selector = "section.menu-category",
                Repeating = true,
                Children =
                [
                    new DataFieldNode { Name = "Titel", Selector = "h2" },
                    new GroupNode
                    {
                        Name = "Gericht",
                        Selector = "li.menu-item",
                        Repeating = true,
                        Children =
                        [
                            new DataFieldNode { Name = "Name", Selector = "h3" },
                            new DataFieldNode { Name = "Link", Selector = "a", Mode = ExtractMode.Attribute, Attribute = "href" },
                            new DataFieldNode { Name = "Vegan", Selector = ".vegan", Mode = ExtractMode.Exists },
                        ],
                    },
                ],
            },
        };

        var result = ScrapingPlanValidator.Validate(GroupPlan(roots));

        Assert.True(result.Success);
        Assert.Null(result.Error);
    }

    // Container-Mode works identically regardless of engine — unlike
    // WaitFor/Fill/Click it's not in browserOnlySteps.
    [Fact]
    public void Validate_GroupPlanWithStaticEngine_Succeeds()
    {
        var roots = new List<GroupNode>
        {
            new() { Name = "Kategorie", Selector = "section", Repeating = true, Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }] },
        };

        var result = ScrapingPlanValidator.Validate(GroupPlan(roots, ScrapingEngine.Static));

        Assert.True(result.Success);
    }

    [Fact]
    public void Validate_EmptyRoots_Fails()
    {
        var result = ScrapingPlanValidator.Validate(GroupPlan([]));
        Assert.False(result.Success);
        Assert.Contains("ExtractGroupStep", result.Error);
    }

    [Fact]
    public void Validate_GroupWithEmptyName_Fails()
    {
        var roots = new List<GroupNode> { new() { Name = " ", Selector = "section", Repeating = true, Children = [] } };
        var result = ScrapingPlanValidator.Validate(GroupPlan(roots));
        Assert.False(result.Success);
        Assert.Contains("Name", result.Error);
    }

    [Fact]
    public void Validate_GroupWithEmptySelector_Fails()
    {
        var roots = new List<GroupNode> { new() { Name = "Kategorie", Selector = " ", Repeating = true, Children = [] } };
        var result = ScrapingPlanValidator.Validate(GroupPlan(roots));
        Assert.False(result.Success);
        Assert.Contains("Selector", result.Error);
        Assert.Contains("Kategorie", result.Error);
    }

    [Fact]
    public void Validate_NestedDataFieldWithEmptySelector_Fails()
    {
        var roots = new List<GroupNode>
        {
            new()
            {
                Name = "Kategorie", Selector = "section", Repeating = true,
                Children = [new DataFieldNode { Name = "Titel", Selector = " " }],
            },
        };
        var result = ScrapingPlanValidator.Validate(GroupPlan(roots));
        Assert.False(result.Success);
        Assert.Contains("Selector", result.Error);
        Assert.Contains("Titel", result.Error);
    }

    [Fact]
    public void Validate_DataFieldAttributeModeWithoutAttribute_Fails()
    {
        var roots = new List<GroupNode>
        {
            new()
            {
                Name = "Kategorie", Selector = "section", Repeating = true,
                Children = [new DataFieldNode { Name = "Link", Selector = "a", Mode = ExtractMode.Attribute }],
            },
        };
        var result = ScrapingPlanValidator.Validate(GroupPlan(roots));
        Assert.False(result.Success);
        Assert.Contains("Attribut", result.Error);
        Assert.Contains("Link", result.Error);
    }

    // ── API-Mode (ApiCallStep) ────────────────────────────────────────────

    private static ApiConfig ValidApiConfig() => new()
    {
        UrlTemplate = "https://example.com/api/items?category={category}",
        ItemsPath = "data.items",
        Fields = [new ApiField { Name = "Titel", Path = "title" }],
        Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
    };

    private static ScrapingPlan ApiPlan(ApiConfig api) => new()
    {
        Engine = ScrapingEngine.Api,
        Steps = [new NavigateStep { Url = "https://example.com" }, new ApiCallStep { Config = api }],
    };

    [Fact]
    public void Validate_ValidApiConfig_Succeeds()
    {
        var result = ScrapingPlanValidator.Validate(ApiPlan(ValidApiConfig()));
        Assert.True(result.Success);
        Assert.Null(result.Error);
    }

    [Theory]
    [InlineData("POST")]
    [InlineData("get")]
    [InlineData("")]
    public void Validate_ApiConfigWithNonGetMethod_Fails(string method)
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            Method = method, UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath,
            Fields = api.Fields, Parameters = api.Parameters,
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("GET", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithEmptyItemsPath_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate, ItemsPath = " ", Fields = api.Fields, Parameters = api.Parameters,
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("ItemsPath", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithNoFields_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath, Fields = [], Parameters = api.Parameters,
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Feld", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithDuplicateFieldNames_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items",
            ItemsPath = api.ItemsPath,
            Fields = [new ApiField { Name = "Titel", Path = "title" }, new ApiField { Name = "Titel", Path = "name" }],
            Parameters = api.Parameters,
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Doppelte Feldnamen", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithFieldNameCollidingWithParameterName_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?category={category}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "category", Path = "categorySlug" }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("kollidieren", result.Error);
        Assert.Contains("category", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithNoParameters_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items", ItemsPath = api.ItemsPath, Fields = api.Fields, Parameters = [],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Parameter", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithPlaceholderMissingParameter_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?category={category}&week={week}",
            ItemsPath = api.ItemsPath, Fields = api.Fields, Parameters = api.Parameters,
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("week", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithUnusedParameter_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items",
            ItemsPath = api.ItemsPath, Fields = api.Fields, Parameters = api.Parameters,
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("category", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithDuplicateParameterNames_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?category={category}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters =
            [
                new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } },
                new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["b"] } },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Doppelte Parameternamen", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithEmptyStaticListSource_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?category={category}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = [] } }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Werteliste", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithDiscoverySourceMissingItemsPath_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?category={category}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters =
            [
                new ApiParameter
                {
                    Name = "category",
                    Source = new DiscoverySource { UrlTemplate = "https://example.com/api/categories", ItemsPath = " ", ValuePath = "id" },
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("ItemsPath", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithRangeSourceMissingTo_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?week={week}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "week", Source = new RangeSource { Type = RangeType.IsoWeek, From = "2026-W01", To = " " } }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Bereich", result.Error);
    }

    // Reproduces the reported bug exactly: a site (penny.de) uses "2026-35"
    // in its own URL instead of ISO-8601 "2026-W35" — this used to only
    // fail deep inside the generated script (raw Python traceback). Without
    // an explicit Format, the default "{yyyy}-W{ww}" applies and correctly
    // rejects it here instead, with a message pointing at the mismatch.
    [Fact]
    public void Validate_ApiConfigWithIsoWeekRangeNotMatchingDefaultFormat_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?week={week}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "week", Source = new RangeSource { Type = RangeType.IsoWeek, From = "2026-35", To = "2026-50" } }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("2026-35", result.Error);
        Assert.Contains("Format", result.Error);
    }

    // The same From/To values succeed once a matching Format is set — this
    // is the actual fix, not just a friendlier rejection.
    [Fact]
    public void Validate_ApiConfigWithIsoWeekRangeMatchingCustomFormat_Succeeds()
    {
        var valid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?week={week}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "week", Source = new RangeSource { Type = RangeType.IsoWeek, From = "2026-35", To = "2026-50", Format = "{yyyy}-{ww}" } }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithRangeSourceInvalidFormat_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?week={week}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            // {dd} isn't a valid token for IsoWeek, and {ww} is missing.
            Parameters = [new ApiParameter { Name = "week", Source = new RangeSource { Type = RangeType.IsoWeek, From = "2026-35", To = "2026-50", Format = "{yyyy}-{dd}" } }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Format", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithNumberRangeNonIntegerValue_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?page={page}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "page", Source = new RangeSource { Type = RangeType.Number, From = "eins", To = "10" } }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("eins", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithValidDiscoverySource_Succeeds()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?category={category}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters =
            [
                new ApiParameter
                {
                    Name = "category",
                    Source = new DiscoverySource { UrlTemplate = "https://example.com/api/categories", ItemsPath = "data", ValuePath = "id" },
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.True(result.Success);
    }

    [Fact]
    public void Validate_ApiConfigWithHeaderMissingValueAndEnvironmentVariable_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath, Fields = api.Fields, Parameters = api.Parameters,
            Headers = [new ApiHeader { Name = "Authorization" }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Authorization", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithHeaderSettingBothValueAndEnvironmentVariable_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath, Fields = api.Fields, Parameters = api.Parameters,
            Headers = [new ApiHeader { Name = "Authorization", Value = "Bearer x", EnvironmentVariableName = "SF_TOKEN" }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Authorization", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithHeaderInvalidEnvironmentVariableName_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath, Fields = api.Fields, Parameters = api.Parameters,
            Headers = [new ApiHeader { Name = "Authorization", EnvironmentVariableName = "BAD-NAME" }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Umgebungsvariablen-Name", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithDuplicateHeaderNames_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath, Fields = api.Fields, Parameters = api.Parameters,
            Headers =
            [
                new ApiHeader { Name = "Authorization", Value = "Bearer a" },
                new ApiHeader { Name = "Authorization", EnvironmentVariableName = "SF_TOKEN" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Doppelte Header-Namen", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithValidHeaders_Succeeds()
    {
        var api = ValidApiConfig();
        var valid = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath, Fields = api.Fields, Parameters = api.Parameters,
            Headers =
            [
                new ApiHeader { Name = "Accept", Value = "application/json" },
                new ApiHeader { Name = "Authorization", EnvironmentVariableName = "SF_TOKEN" },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success);
    }
}
