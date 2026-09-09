using System.Collections.Concurrent;
using System.Net;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// These tests actually spawn python3 and run the generated API-Mode script —
// same "prove the real artifact works" philosophy as PythonScriptVerifierTests,
// just against a fake JSON API (LocalTestServer's request-aware responder
// overload) instead of canned HTML.
public class PythonApiScriptVerifierTests
{
    private static ScrapingPlan PlanWith(ApiConfig api) => new()
    {
        Steps = [new NavigateStep { Url = "https://example.com" }, new ApiCallStep { Config = api }],
        OutputFormat = OutputFormat.Csv,
        Engine = ScrapingEngine.Api,
    };

    private static string GenerateScript(ApiConfig api) => new PythonApiCodeGenerator().Generate(PlanWith(api));

    // Issue #86: same shape as PlanWith/GenerateScript above, just with
    // OutputFormat.Json instead of the hardcoded Csv — used for both the
    // flat and tree API shapes, which self-describe via the written
    // output.json's own root JsonNode type (see PythonScriptVerifier).
    private static ScrapingPlan PlanWithJson(ApiConfig api) => new()
    {
        Steps = [new NavigateStep { Url = "https://example.com" }, new ApiCallStep { Config = api }],
        OutputFormat = OutputFormat.Json,
        Engine = ScrapingEngine.Api,
    };

    private static string GenerateJsonScript(ApiConfig api) => new PythonApiCodeGenerator().Generate(PlanWithJson(api));

    [Fact]
    public async Task StaticListParameter_FetchesOneCombinationPerValue_Succeeds()
    {
        using var server = new LocalTestServer(request =>
        {
            var category = request.QueryString["category"];
            var json = $$"""{ "data": { "items": [ { "title": "Item-{{category}}", "meta": { "price": 9 } } ] } }""";
            return new LocalTestServerResponse(json, "application/json");
        });

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?category={{category}}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }, new ApiField { Name = "Preis", Path = "meta.price" }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a", "b"] } }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.True(result.Success, result.Error);
        Assert.Equal(2, result.RowCount); // one row per category value
    }

    [Fact]
    public async Task DiscoverySourceParameter_ResolvesValuesFromASecondRequest_Succeeds()
    {
        // Two distinct, real HTTP requests against the same test server: one
        // to the discovery endpoint (?discover=1) to learn the category
        // values, one per discovered category to the main endpoint.
        using var server = new LocalTestServer(request =>
        {
            if (request.QueryString["discover"] == "1")
            {
                return new LocalTestServerResponse(
                    """{ "data": [ { "slug": "books" }, { "slug": "toys" } ] }""", "application/json");
            }

            var category = request.QueryString["category"];
            var json = $$"""{ "data": { "items": [ { "title": "Item-{{category}}" } ] } }""";
            return new LocalTestServerResponse(json, "application/json");
        });

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?category={{category}}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters =
            [
                new ApiParameter
                {
                    Name = "category",
                    Source = new DiscoverySource
                    {
                        UrlTemplate = $"{server.BaseUrl}?discover=1",
                        ItemsPath = "data",
                        ValuePath = "slug",
                    },
                },
            ],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.True(result.Success, result.Error);
        Assert.Equal(2, result.RowCount); // one row per discovered category
    }

    [Fact]
    public async Task NumberRangeParameter_ExpandsFromToInclusive_Succeeds()
    {
        using var server = new LocalTestServer(request =>
        {
            var page = request.QueryString["page"];
            var json = $$"""{ "items": [ { "title": "Page-{{page}}" } ] }""";
            return new LocalTestServerResponse(json, "application/json");
        });

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?page={{page}}",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "page", Source = new RangeSource { Type = RangeType.Number, From = "1", To = "3" } }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, result.RowCount); // pages 1, 2, 3
    }

    [Fact]
    public async Task IsoWeekRangeParameter_ExpandsInclusiveWeekRange_Succeeds()
    {
        using var server = new LocalTestServer(request =>
        {
            var week = request.QueryString["week"];
            var json = $$"""{ "items": [ { "title": "Week-{{week}}" } ] }""";
            return new LocalTestServerResponse(json, "application/json");
        });

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?week={{week}}",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            // 2026-W01 through 2026-W03 inclusive — 3 weeks.
            Parameters = [new ApiParameter { Name = "week", Source = new RangeSource { Type = RangeType.IsoWeek, From = "2026-W01", To = "2026-W03" } }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, result.RowCount);
    }

    // Reproduces the reported bug's exact scenario (penny.de using "2026-35"
    // instead of ISO-8601 "2026-W35") end to end: a real script run with a
    // custom Format now succeeds instead of crashing with a raw traceback.
    [Fact]
    public async Task IsoWeekRangeParameterWithCustomFormat_MatchingTheSiteConvention_Succeeds()
    {
        using var server = new LocalTestServer(request =>
        {
            var week = request.QueryString["week"];
            var json = $$"""{ "items": [ { "title": "Week-{{week}}" } ] }""";
            return new LocalTestServerResponse(json, "application/json");
        });

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?week={{week}}",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            // 2026-35 through 2026-37 inclusive — 3 weeks, "yyyy-ww" without
            // the ISO "W" separator (the site's own convention, not ISO-8601).
            Parameters = [new ApiParameter { Name = "week", Source = new RangeSource { Type = RangeType.IsoWeek, From = "2026-35", To = "2026-37", Format = "{yyyy}-{ww}" } }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, result.RowCount);
    }

    [Fact]
    public async Task DateRangeParameterWithCustomFormat_Succeeds()
    {
        using var server = new LocalTestServer(request =>
        {
            var date = request.QueryString["date"];
            var json = $$"""{ "items": [ { "title": "Date-{{date}}" } ] }""";
            return new LocalTestServerResponse(json, "application/json");
        });

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?date={{date}}",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            // 01.01.2026 through 03.01.2026 inclusive — 3 days, DD.MM.YYYY.
            Parameters = [new ApiParameter { Name = "date", Source = new RangeSource { Type = RangeType.Date, From = "01.01.2026", To = "03.01.2026", Format = "{dd}.{mm}.{yyyy}" } }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, result.RowCount);
    }

    [Fact]
    public async Task DateRangeParameter_ExpandsInclusiveDateRange_Succeeds()
    {
        using var server = new LocalTestServer(request =>
        {
            var date = request.QueryString["date"];
            var json = $$"""{ "items": [ { "title": "Date-{{date}}" } ] }""";
            return new LocalTestServerResponse(json, "application/json");
        });

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?date={{date}}",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            // 2026-01-01 through 2026-01-04 inclusive — 4 days.
            Parameters = [new ApiParameter { Name = "date", Source = new RangeSource { Type = RangeType.Date, From = "2026-01-01", To = "2026-01-04" } }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.True(result.Success, result.Error);
        Assert.Equal(4, result.RowCount);
    }

    [Fact]
    public async Task AuthHeaderFromEnvironmentVariable_IsSentAsRealHeader_Succeeds()
    {
        const string envVarName = "SF_TEST_API_TOKEN";
        using var server = new LocalTestServer(request =>
        {
            var authHeader = request.Headers["Authorization"];
            var json = authHeader == "Bearer secret-token"
                ? """{ "items": [ { "title": "Authorized" } ] }"""
                : """{ "items": [] }""";
            return new LocalTestServerResponse(json, "application/json");
        });

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?category={{category}}",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
            Headers = [new ApiHeader { Name = "Authorization", EnvironmentVariableName = envVarName }],
        };

        Environment.SetEnvironmentVariable(envVarName, "Bearer secret-token");
        try
        {
            var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));
            Assert.True(result.Success, result.Error);
            Assert.Equal(1, result.RowCount);
        }
        finally
        {
            Environment.SetEnvironmentVariable(envVarName, null);
        }
    }

    [Fact]
    public async Task ItemsPathMatchingNothing_FailsWithZeroDataRows()
    {
        using var server = new LocalTestServer(_ =>
            new LocalTestServerResponse("""{ "items": [] }""", "application/json"));

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?category={{category}}",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.False(result.Success);
        Assert.Contains("no data", result.Error);
        Assert.Equal(0, result.RowCount);
    }

    // Reproduces the reported bug: Api-Mode tries the full cartesian product
    // of every parameter's values without knowing which combinations
    // actually exist on the target site — a 404 for one of them (e.g. a
    // category with no offers for a given week) used to abort the whole
    // script instead of just skipping that one combination.
    [Fact]
    public async Task SomeCombinationsReturning404_AreSkippedNotFailed_Succeeds()
    {
        using var server = new LocalTestServer(request =>
        {
            var category = request.QueryString["category"];
            return category == "missing"
                ? new LocalTestServerResponse("not found", "text/plain", HttpStatusCode.NotFound)
                : new LocalTestServerResponse($$"""{ "items": [ { "title": "Item-{{category}}" } ] }""", "application/json");
        });

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?category={{category}}",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a", "missing", "b"] } }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.True(result.Success, result.Error);
        Assert.Equal(2, result.RowCount); // "missing" skipped, "a" and "b" succeeded
    }

    // The skip-on-404 behavior above must not silently turn a genuinely
    // broken configuration into a "successful" empty result — the existing
    // "at least one output row" check still applies when nothing succeeds.
    [Fact]
    public async Task AllCombinationsReturning404_StillFailsWithZeroDataRows()
    {
        using var server = new LocalTestServer(_ =>
            new LocalTestServerResponse("not found", "text/plain", HttpStatusCode.NotFound));

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?category={{category}}",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a", "b"] } }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.False(result.Success);
        Assert.Equal(0, result.RowCount);
    }

    [Fact]
    public async Task PageReturning500_FailsWithScriptErrorOutput()
    {
        using var server = new LocalTestServer(_ =>
            new LocalTestServerResponse("server error", "text/plain", HttpStatusCode.InternalServerError));

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?category={{category}}",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.False(result.Success);
        Assert.NotNull(result.Error);
    }

    // ── Groups (Issue #54's tree shape, OutputFormat.Xml) ────────────────
    // Same "prove the real artifact works" philosophy as the flat/CSV tests
    // above, but against a shape mirroring Phase 0's nested catalog fixture
    // (test-pages/api-nested-and-post/server.py): categories[*] →
    // subcategories[*] → products[*], three independent repeating levels.

    [Fact]
    public async Task GroupedScript_ThreeLevelNesting_SucceedsAndWritesXml()
    {
        using var server = new LocalTestServer(_ => new LocalTestServerResponse(
            """
            {
              "categories": [
                {
                  "name": "Elektronik",
                  "subcategories": [
                    {
                      "name": "Telefone",
                      "products": [
                        { "title": "Smartphone X" },
                        { "title": "Smartphone Y" }
                      ]
                    }
                  ]
                },
                {
                  "name": "Bücher",
                  "subcategories": [
                    { "name": "Romane", "products": [ { "title": "Buch A" } ] }
                  ]
                }
              ]
            }
            """, "application/json"));

        var api = new ApiConfig
        {
            UrlTemplate = server.BaseUrl,
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
                            Name = "Subkategorie",
                            Path = "subcategories",
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
                },
            ],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api), OutputFormat.Xml);

        Assert.True(result.Success, result.Error);
        // 2 <Kategorie> + 2 <Name> (category) + 2 <Subkategorie> + 2 <Name>
        // (subcategory) + 3 <Produkt> + 3 <Titel> = 14
        Assert.Equal(14, result.RowCount);
    }

    [Fact]
    public async Task GroupedScript_EmptyPathArrayOfArrays_SucceedsAndFlattensOneLevel()
    {
        // A raw array-of-arrays with no object key between the two repeating
        // levels — ApiGroup.Path == "" means "operate directly on the
        // parent scope itself" (see ApiGroup's doc comment).
        using var server = new LocalTestServer(_ => new LocalTestServerResponse(
            """{ "rows": [ [ { "title": "A" }, { "title": "B" } ], [ { "title": "C" } ] ] }""", "application/json"));

        var api = new ApiConfig
        {
            UrlTemplate = server.BaseUrl,
            Groups =
            [
                new ApiGroup
                {
                    Name = "Zeile",
                    Path = "rows",
                    Children =
                    [
                        new ApiGroup
                        {
                            Name = "Eintrag",
                            Path = "",
                            Children = [new ApiField { Name = "Titel", Path = "title" }],
                        },
                    ],
                },
            ],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api), OutputFormat.Xml);

        Assert.True(result.Success, result.Error);
        // 2 <Zeile> + 3 <Eintrag> + 3 <Titel> = 8
        Assert.Equal(8, result.RowCount);
    }

    [Fact]
    public async Task GroupedScript_ParameterizedRequest_CombinesResultsAcrossCombinations()
    {
        using var server = new LocalTestServer(request =>
        {
            var category = request.QueryString["category"];
            var json = $$"""{ "products": [ { "title": "Item-{{category}}" } ] }""";
            return new LocalTestServerResponse(json, "application/json");
        });

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?category={{category}}",
            Groups = [new ApiGroup { Name = "Produkt", Path = "products", Children = [new ApiField { Name = "Titel", Path = "title" }] }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a", "b"] } }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api), OutputFormat.Xml);

        Assert.True(result.Success, result.Error);
        // 2 <Produkt> + 2 <Titel> = 4, combined across both category requests
        Assert.Equal(4, result.RowCount);
    }

    [Fact]
    public async Task GroupedScript_PathMatchingNothing_FailsWithZeroElements()
    {
        using var server = new LocalTestServer(_ =>
            new LocalTestServerResponse("""{ "categories": [] }""", "application/json"));

        var api = new ApiConfig
        {
            UrlTemplate = server.BaseUrl,
            Groups = [new ApiGroup { Name = "Kategorie", Path = "categories", Children = [new ApiField { Name = "Name", Path = "name" }] }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api), OutputFormat.Xml);

        Assert.False(result.Success);
        Assert.Contains("no data", result.Error);
        Assert.Equal(0, result.RowCount);
    }

    [Fact]
    public async Task GroupedScript_SomeCombinationsReturning404_AreSkippedNotFailed_Succeeds()
    {
        using var server = new LocalTestServer(request =>
        {
            var category = request.QueryString["category"];
            return category == "missing"
                ? new LocalTestServerResponse("not found", "text/plain", HttpStatusCode.NotFound)
                : new LocalTestServerResponse($$"""{ "products": [ { "title": "Item-{{category}}" } ] }""", "application/json");
        });

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?category={{category}}",
            Groups = [new ApiGroup { Name = "Produkt", Path = "products", Children = [new ApiField { Name = "Titel", Path = "title" }] }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a", "missing"] } }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api), OutputFormat.Xml);

        Assert.True(result.Success, result.Error);
        // 1 <Produkt> + 1 <Titel> = 2, "missing" skipped
        Assert.Equal(2, result.RowCount);
    }

    // ── Request body (Issue #55) ──────────────────────────────────────────
    // Actually spawns the generated script and inspects what LocalTestServer
    // received server-side (HttpMethod, InputStream) — proves the real
    // wire-level request, not just the generated source text (already
    // covered by PythonApiCodeGeneratorTests).

    [Fact]
    public async Task PostMethod_NoBody_SendsPostRequest_Succeeds()
    {
        string? observedMethod = null;
        using var server = new LocalTestServer(request =>
        {
            observedMethod = request.HttpMethod;
            return new LocalTestServerResponse("""{ "items": [ { "title": "A" } ] }""", "application/json");
        });

        var api = new ApiConfig
        {
            Method = "POST",
            UrlTemplate = server.BaseUrl,
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.True(result.Success, result.Error);
        Assert.Equal("POST", observedMethod);
    }

    [Fact]
    public async Task PostMethod_WithFixedLiteralBody_SendsExactBodyToServer_Succeeds()
    {
        string? observedBody = null;
        using var server = new LocalTestServer(request =>
        {
            using var reader = new StreamReader(request.InputStream, request.ContentEncoding);
            observedBody = reader.ReadToEnd();
            return new LocalTestServerResponse("""{ "items": [ { "title": "A" } ] }""", "application/json");
        });

        var api = new ApiConfig
        {
            Method = "POST",
            UrlTemplate = server.BaseUrl,
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Body = new ApiBodyObject
            {
                Properties = new Dictionary<string, ApiBodyNode>
                {
                    ["category"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.String, StringValue = "electronics" },
                    ["maxPrice"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.Number, NumberValue = 500 },
                },
            },
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.True(result.Success, result.Error);
        Assert.NotNull(observedBody);
        Assert.Contains("\"category\": \"electronics\"", observedBody);
        Assert.Contains("\"maxPrice\": 500", observedBody);
    }

    [Fact]
    public async Task PostMethod_WithVariableBody_SendsDifferentBodyPerCombination_Succeeds()
    {
        var observedBodies = new ConcurrentBag<string>();
        using var server = new LocalTestServer(request =>
        {
            using var reader = new StreamReader(request.InputStream, request.ContentEncoding);
            observedBodies.Add(reader.ReadToEnd());
            return new LocalTestServerResponse("""{ "items": [ { "title": "A" } ] }""", "application/json");
        });

        var api = new ApiConfig
        {
            Method = "POST",
            UrlTemplate = server.BaseUrl,
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a", "b"] } }],
            Body = new ApiBodyObject
            {
                Properties = new Dictionary<string, ApiBodyNode> { ["category"] = new ApiBodyVariable { ParameterName = "category" } },
            },
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.True(result.Success, result.Error);
        Assert.Equal(2, observedBodies.Count);
        Assert.Contains(observedBodies, body => body.Contains("\"category\": \"a\""));
        Assert.Contains(observedBodies, body => body.Contains("\"category\": \"b\""));
    }

    [Fact]
    public async Task PostMethod_WithCoerceToNumber_SendsNumericJsonValueNotString_Succeeds()
    {
        string? observedBody = null;
        using var server = new LocalTestServer(request =>
        {
            using var reader = new StreamReader(request.InputStream, request.ContentEncoding);
            observedBody = reader.ReadToEnd();
            return new LocalTestServerResponse("""{ "items": [ { "title": "A" } ] }""", "application/json");
        });

        var api = new ApiConfig
        {
            Method = "POST",
            UrlTemplate = server.BaseUrl,
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "page", Source = new RangeSource { Type = RangeType.Number, From = "1", To = "1" } }],
            Body = new ApiBodyObject
            {
                Properties = new Dictionary<string, ApiBodyNode> { ["page"] = new ApiBodyVariable { ParameterName = "page", CoerceTo = ApiBodyLiteralKind.Number } },
            },
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.True(result.Success, result.Error);
        Assert.NotNull(observedBody);
        // Not '"page": "1"' — the string form an uncoerced parameter value
        // (every ApiParameterSource value is string-typed end to end) would
        // otherwise produce.
        Assert.Contains("\"page\": 1", observedBody);
        Assert.DoesNotContain("\"page\": \"1\"", observedBody);
    }

    // Concretizes the case that actually motivated a typed body tree: a
    // GraphQL body's fixed "query" text never varies across the cartesian
    // product, while its nested "variables" object does — with no dedicated
    // GraphQL handling anywhere in the generated script either.
    [Fact]
    public async Task PostMethod_GraphQlShapedBody_QueryFixedVariablesVary_Succeeds()
    {
        var observedBodies = new ConcurrentBag<string>();
        using var server = new LocalTestServer(request =>
        {
            using var reader = new StreamReader(request.InputStream, request.ContentEncoding);
            observedBodies.Add(reader.ReadToEnd());
            return new LocalTestServerResponse(
                """{ "data": { "categoryProducts": { "items": [ { "title": "A" } ] } } }""", "application/json");
        });

        var api = new ApiConfig
        {
            Method = "POST",
            UrlTemplate = server.BaseUrl,
            ItemsPath = "data.categoryProducts.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["electronics", "books"] } }],
            Body = new ApiBodyObject
            {
                Properties = new Dictionary<string, ApiBodyNode>
                {
                    ["query"] = new ApiBodyLiteral
                    {
                        Kind = ApiBodyLiteralKind.String,
                        StringValue = "query($category: String) { categoryProducts(category: $category) { items { title } } }",
                    },
                    ["variables"] = new ApiBodyObject
                    {
                        Properties = new Dictionary<string, ApiBodyNode> { ["category"] = new ApiBodyVariable { ParameterName = "category" } },
                    },
                },
            },
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api));

        Assert.True(result.Success, result.Error);
        Assert.Equal(2, observedBodies.Count);
        Assert.All(observedBodies, body => Assert.Contains("categoryProducts(category: $category)", body));
        Assert.Contains(observedBodies, body => body.Contains("\"category\": \"electronics\""));
        Assert.Contains(observedBodies, body => body.Contains("\"category\": \"books\""));
    }

    [Fact]
    public async Task GroupedScript_PostMethodWithBody_SendsBodyAndWritesXml_Succeeds()
    {
        string? observedBody = null;
        using var server = new LocalTestServer(request =>
        {
            using var reader = new StreamReader(request.InputStream, request.ContentEncoding);
            observedBody = reader.ReadToEnd();
            return new LocalTestServerResponse("""{ "products": [ { "title": "A" } ] }""", "application/json");
        });

        var api = new ApiConfig
        {
            Method = "POST",
            UrlTemplate = server.BaseUrl,
            Groups = [new ApiGroup { Name = "Produkt", Path = "products", Children = [new ApiField { Name = "Titel", Path = "title" }] }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["electronics"] } }],
            Body = new ApiBodyObject
            {
                Properties = new Dictionary<string, ApiBodyNode> { ["category"] = new ApiBodyVariable { ParameterName = "category" } },
            },
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateScript(api), OutputFormat.Xml);

        Assert.True(result.Success, result.Error);
        Assert.Equal(2, result.RowCount); // 1 <Produkt> + 1 <Titel>
        Assert.NotNull(observedBody);
        Assert.Contains("\"category\": \"electronics\"", observedBody);
    }

    // ── Json output (Issue #86) ─────────────────────────────────────────

    [Fact]
    public async Task JsonOutput_FlatShape_Succeeds()
    {
        using var server = new LocalTestServer(request =>
        {
            var category = request.QueryString["category"];
            var json = $$"""{ "data": { "items": [ { "title": "Item-{{category}}" } ] } }""";
            return new LocalTestServerResponse(json, "application/json");
        });

        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}?category={{category}}",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a", "b"] } }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateJsonScript(api), OutputFormat.Json, includePreview: true);

        Assert.True(result.Success, result.Error);
        Assert.Equal(2, result.RowCount);
        Assert.NotNull(result.Preview);
        Assert.Equal("Json", result.Preview.OutputFormat);
        Assert.Contains("Titel", result.Preview.Columns!);
    }

    [Fact]
    public async Task JsonOutput_TreeShape_Succeeds()
    {
        using var server = new LocalTestServer(_ => new LocalTestServerResponse(
            """{ "products": [ { "title": "A" }, { "title": "B" } ] }""", "application/json"));

        var api = new ApiConfig
        {
            UrlTemplate = server.BaseUrl,
            Groups = [new ApiGroup { Name = "Produkt", Path = "products", Children = [new ApiField { Name = "Titel", Path = "title" }] }],
        };

        var result = await new PythonScriptVerifier().VerifyAsync(GenerateJsonScript(api), OutputFormat.Json, includePreview: true);

        Assert.True(result.Success, result.Error);
        Assert.NotNull(result.Preview);
        Assert.Equal("Json", result.Preview.OutputFormat);
        Assert.Contains("\"Titel\"", result.Preview.JsonSample);
    }
}
