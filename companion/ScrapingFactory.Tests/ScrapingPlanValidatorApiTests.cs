using ScrapingFactory.Compiler.IR;
using Xunit;
using static ScrapingFactory.Tests.ValidatorTestPlans;

namespace ScrapingFactory.Tests;

// API mode: ApiConfig, parameter sources, discovery and headers. (ScrapingPlanValidator; the plan builders are in ValidatorTestPlans.)
public class ScrapingPlanValidatorApiTests
{
    [Fact]
    public void Validate_ValidApiConfig_Succeeds()
    {
        var result = ScrapingPlanValidator.Validate(ApiPlan(ValidApiConfig()));
        Assert.True(result.Success);
        Assert.Null(result.Error);
    }

    [Theory]
    [InlineData("PUT")]
    [InlineData("DELETE")]
    [InlineData("get")]
    [InlineData("")]
    public void Validate_ApiConfigWithUnsupportedMethod_Fails(string method)
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

    // POST (Issue #55) is now a supported method, unlike PUT/DELETE/etc.
    // above — a bodyless POST (no ApiConfig.Body set) is still a fully
    // valid config, exactly like the existing GET-based ValidApiConfig().
    [Fact]
    public void Validate_ApiConfigWithPostMethodAndNoBody_Succeeds()
    {
        var api = ValidApiConfig();
        var valid = new ApiConfig
        {
            Method = "POST", UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath,
            Fields = api.Fields, Parameters = api.Parameters,
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
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
        Assert.Contains("field", result.Error);
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
        Assert.Contains("Duplicate field names", result.Error);
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
        Assert.Contains("collide", result.Error);
        Assert.Contains("category", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithInvalidRegexTransform_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate,
            ItemsPath = api.ItemsPath,
            Fields = [new ApiField { Name = "Titel", Path = "title", Transforms = [new RegexExtractTransform { Pattern = "(" }] }],
            Parameters = api.Parameters,
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Titel", result.Error);
    }

    // A fully static endpoint — every URL part fixed, nothing to enumerate
    // over — is a legitimate Api-Mode config, not just a degenerate one:
    // the extension previously forced at least one variable part before
    // "Übernehmen" was even enabled, but the underlying config format (and
    // the generated script, via itertools.product over zero value lists)
    // always supported zero parameters just fine.
    [Fact]
    public void Validate_ApiConfigWithNoParameters_Succeeds()
    {
        var api = ValidApiConfig();
        var valid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items", ItemsPath = api.ItemsPath, Fields = api.Fields, Parameters = [],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
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
        Assert.Contains("Duplicate parameter names", result.Error);
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
        Assert.Contains("value list", result.Error);
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
        Assert.Contains("Range for parameter", result.Error);
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
        Assert.Contains("format", result.Error);
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
    public void Validate_ApiConfigWithValidBrowserDiscoverySource_Succeeds()
    {
        var valid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?category={category}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters =
            [
                new ApiParameter
                {
                    Name = "category",
                    Source = new BrowserDiscoverySource
                    {
                        DiscoveryUrl = "https://example.com/angebote",
                        Actions = [new ClickAction { Selector = "#load-more" }],
                    },
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    // Actions is optional/null — "just load DiscoveryUrl and observe
    // whatever fires natively" is a valid, minimal configuration.
    [Fact]
    public void Validate_ApiConfigWithBrowserDiscoverySourceNoActions_Succeeds()
    {
        var valid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?category={category}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters =
            [
                new ApiParameter { Name = "category", Source = new BrowserDiscoverySource { DiscoveryUrl = "https://example.com/angebote" } },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    [Theory]
    [InlineData("not-a-url")]
    [InlineData("ftp://example.com/angebote")]
    public void Validate_ApiConfigWithBrowserDiscoverySourceInvalidDiscoveryUrl_Fails(string discoveryUrl)
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?category={category}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "category", Source = new BrowserDiscoverySource { DiscoveryUrl = discoveryUrl } }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("DiscoveryUrl", result.Error);
    }

    // Issue #217: a DiscoverySource/BrowserDiscoverySource may reference an
    // earlier-declared parameter's own value via the same "{name}"
    // placeholder syntax UrlTemplate itself uses.
    [Fact]
    public void Validate_ApiConfigWithDiscoverySourceReferencingEarlierParameter_Succeeds()
    {
        var valid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?category={category}&week={week}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters =
            [
                new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a", "b"] } },
                new ApiParameter
                {
                    Name = "week",
                    Source = new DiscoverySource
                    {
                        UrlTemplate = "https://example.com/api/categories/{category}/weeks",
                        ItemsPath = "data",
                        ValuePath = "id",
                    },
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithDiscoverySourceReferencingItself_Fails()
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
                    Source = new DiscoverySource
                    {
                        UrlTemplate = "https://example.com/api/categories/{category}",
                        ItemsPath = "data",
                        ValuePath = "id",
                    },
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("cannot reference itself", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithDiscoverySourceReferencingLaterParameter_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?category={category}&week={week}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters =
            [
                new ApiParameter
                {
                    Name = "category",
                    Source = new DiscoverySource
                    {
                        UrlTemplate = "https://example.com/api/categories/{week}",
                        ItemsPath = "data",
                        ValuePath = "id",
                    },
                },
                new ApiParameter { Name = "week", Source = new StaticListSource { Values = ["1", "2"] } },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("declared later", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithDiscoverySourceReferencingUnknownPlaceholder_Succeeds()
    {
        // A placeholder that isn't any declared parameter's name at all is
        // left alone — same laissez-faire this template's own
        // un-cross-checked UrlTemplate always had, not a reference this
        // validator understands.
        var valid = new ApiConfig
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
                        UrlTemplate = "https://example.com/api/categories/{unrelated}",
                        ItemsPath = "data",
                        ValuePath = "id",
                    },
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithBrowserDiscoverySourceReferencingEarlierParameter_Succeeds()
    {
        var valid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?category={category}&week={week}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters =
            [
                new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a", "b"] } },
                new ApiParameter
                {
                    Name = "week",
                    Source = new BrowserDiscoverySource { DiscoveryUrl = "https://example.com/angebote/{category}" },
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithBrowserDiscoverySourceReferencingItself_Fails()
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
                    Source = new BrowserDiscoverySource { DiscoveryUrl = "https://example.com/angebote/{category}" },
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("cannot reference itself", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithBrowserDiscoverySourceReferencingLaterParameter_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items?category={category}&week={week}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters =
            [
                new ApiParameter
                {
                    Name = "category",
                    Source = new BrowserDiscoverySource { DiscoveryUrl = "https://example.com/angebote/{week}" },
                },
                new ApiParameter { Name = "week", Source = new StaticListSource { Values = ["1", "2"] } },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("declared later", result.Error);
    }

    // BrowserDiscoverySource only means anything relative to UrlTemplate
    // itself (see its own doc comment) — a parameter using it that never
    // appears in UrlTemplate would have nothing to match captured requests
    // against. Referenced from Body instead (Method "POST") rather than
    // left fully unused, so this specifically exercises the
    // BrowserDiscoverySource-vs-UrlTemplate check rather than the more
    // generic "parameter referenced by neither UrlTemplate nor Body" one.
    [Fact]
    public void Validate_ApiConfigWithBrowserDiscoverySourceParameterNotInUrlTemplate_Fails()
    {
        var invalid = new ApiConfig
        {
            Method = "POST",
            UrlTemplate = "https://example.com/api/items",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "category", Source = new BrowserDiscoverySource { DiscoveryUrl = "https://example.com/angebote" } }],
            Body = new ApiBodyObject { Properties = new() { ["category"] = new ApiBodyVariable { ParameterName = "category" } } },
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("nothing to match", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithBrowserDiscoverySourceActionBlankSelector_Fails()
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
                    Source = new BrowserDiscoverySource
                    {
                        DiscoveryUrl = "https://example.com/angebote",
                        Actions = [new ClickAction { Selector = " " }],
                    },
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("ClickAction", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithBrowserDiscoverySourceFillActionInvalidEnvVar_Fails()
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
                    Source = new BrowserDiscoverySource
                    {
                        DiscoveryUrl = "https://example.com/angebote",
                        Actions = [new FillAction { Selector = "#q", EnvironmentVariableName = "123-invalid" }],
                    },
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("environment variable", result.Error);
    }

    // Issue #289
    [Fact]
    public void Validate_ApiConfigWithBrowserDiscoverySourceScrollActionNonPositiveScrollStepPx_Fails()
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
                    Source = new BrowserDiscoverySource
                    {
                        DiscoveryUrl = "https://example.com/angebote",
                        Actions = [new ScrollAction { ScrollStepPx = 0 }],
                    },
                },
            ],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("ScrollStepPx", result.Error);
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
        Assert.Contains("environment variable name", result.Error);
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
        Assert.Contains("Duplicate header names", result.Error);
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
