using ScrapingFactory.Compiler.IR;
using Xunit;
using static ScrapingFactory.Tests.ValidatorTestPlans;

namespace ScrapingFactory.Tests;

// API mode: group trees, request bodies and the embedded JSON source. (ScrapingPlanValidator; the plan builders are in ValidatorTestPlans.)
public class ScrapingPlanValidatorApiTreeTests
{
    [Fact]
    public void Validate_ValidApiGroupsConfig_Succeeds()
    {
        var result = ScrapingPlanValidator.Validate(ApiPlan(ValidApiGroupsConfig()));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithBothFlatAndGroups_Fails()
    {
        var flat = ValidApiConfig();
        var tree = ValidApiGroupsConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = flat.UrlTemplate, ItemsPath = flat.ItemsPath, Fields = flat.Fields,
            Groups = tree.Groups, Parameters = flat.Parameters,
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("mutually exclusive", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithNeitherFlatNorGroups_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items",
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("ItemsPath", result.Error);
        Assert.Contains("Groups", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithItemsPathButNoFields_Fails()
    {
        var invalid = new ApiConfig
        {
            UrlTemplate = "https://example.com/api/items",
            ItemsPath = "data.items",
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("ItemsPath and Fields", result.Error);
    }

    [Fact]
    public void Validate_ApiGroupsConfigWithEmptyGroupName_Fails()
    {
        var invalid = WithGroups([new ApiGroup { Name = " ", Path = "categories", Children = [new ApiField { Name = "Titel", Path = "title" }] }]);
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Name of an Api node", result.Error);
    }

    [Fact]
    public void Validate_ApiGroupsConfigWithEmptyGroupChildren_Fails()
    {
        var invalid = WithGroups([new ApiGroup { Name = "Kategorie", Path = "categories", Children = [] }]);
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("child element", result.Error);
    }

    [Fact]
    public void Validate_ApiGroupsConfigWithEmptyFieldPath_Fails()
    {
        var invalid = WithGroups([new ApiGroup { Name = "Kategorie", Path = "categories", Children = [new ApiField { Name = "Titel", Path = " " }] }]);
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Path of field 'Titel'", result.Error);
    }

    [Fact]
    public void Validate_ApiGroupsConfigWithInvalidRegexTransform_Fails()
    {
        var invalid = WithGroups([
            new ApiGroup
            {
                Name = "Kategorie", Path = "categories",
                Children = [new ApiField { Name = "Titel", Path = "title", Transforms = [new RegexExtractTransform { Pattern = "[unclosed" }] }],
            },
        ]);
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Titel", result.Error);
    }

    // Unlike ApiField.Path, an empty ApiGroup.Path is legitimate (see
    // ApiGroup's doc comment, "array-of-arrays") — must not be rejected the
    // way an empty ApiField.Path is above.
    [Fact]
    public void Validate_ApiGroupsConfigWithEmptyGroupPath_SucceedsWhenFieldStillReachable()
    {
        var valid = WithGroups([new ApiGroup { Name = "Zeile", Path = "", Children = [new ApiField { Name = "Wert", Path = "value" }] }]);
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    // Deeply nested groups-of-groups still succeed as long as a field is
    // reachable at the bottom — proves ApiNodesContainField's recursion
    // isn't accidentally shallow (e.g. only checking direct children).
    [Fact]
    public void Validate_ApiGroupsConfigWithFieldOnlyAtDeepestLevel_Succeeds()
    {
        var valid = WithGroups(
        [
            new ApiGroup
            {
                Name = "Aussen", Path = "outer",
                Children = [new ApiGroup { Name = "Innen", Path = "inner", Children = [new ApiGroup { Name = "GanzInnen", Path = "innermost", Children = [new ApiField { Name = "Wert", Path = "value" }] }] }],
            },
        ]);
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    // ApiNodesContainField's own "no field anywhere" branch is structurally
    // unreachable for any tree that already satisfies ValidateApiNodes'
    // "every group needs ≥1 child" rule: since JSON (and therefore any
    // ApiGroup tree built from it) is finite and acyclic, the deepest node
    // in a tree where every group has children can only be an ApiField —
    // ApiGroup is the only other ApiNode variant, and it would itself
    // require further children, contradicting "deepest". The check is kept
    // anyway for the same reason flat mode keeps its own explicit
    // "Fields.Count == 0" check rather than relying on this argument: it
    // states the actual business rule ("a config must extract something")
    // directly, instead of leaving it as an emergent property of an
    // unrelated structural rule that could change under a future refactor.
    // No dedicated [Fact] for this branch specifically, for that reason —
    // there is no way to construct a finite, otherwise-valid tree that
    // would exercise it.

    [Fact]
    public void Validate_ApiConfigWithPostBodyAndFlatFields_Succeeds()
    {
        var result = ScrapingPlanValidator.Validate(ApiPlan(ValidApiConfigWithPostBody()));
        Assert.True(result.Success, result.Error);
    }

    // Body (request-side) and Groups (response-side, Issue #54) are fully
    // orthogonal — a POST body and a tree-shaped response must be able to
    // coexist, exactly like a plain GET can already be combined with either
    // response shape (see Validate_ValidApiConfig_Succeeds/
    // Validate_ValidApiGroupsConfig_Succeeds above).
    [Fact]
    public void Validate_ApiConfigWithPostBodyAndGroupsTree_Succeeds()
    {
        var tree = ValidApiGroupsConfig();
        var valid = new ApiConfig
        {
            Method = "POST",
            UrlTemplate = tree.UrlTemplate,
            Groups = tree.Groups,
            Parameters = tree.Parameters,
            Body = new ApiBodyObject
            {
                Properties = new Dictionary<string, ApiBodyNode> { ["category"] = new ApiBodyVariable { ParameterName = "category" } },
            },
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithGetMethodAndBody_Fails()
    {
        var api = ValidApiConfigWithPostBody();
        var invalid = new ApiConfig
        {
            Method = "GET", UrlTemplate = api.UrlTemplate, ItemsPath = api.ItemsPath,
            Fields = api.Fields, Parameters = api.Parameters, Body = api.Body,
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Body", result.Error);
        Assert.Contains("POST", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithBodyReferencingUnknownParameter_Fails()
    {
        var invalid = ApiConfigWithBody(
            new ApiBodyObject { Properties = new Dictionary<string, ApiBodyNode> { ["term"] = new ApiBodyVariable { ParameterName = "doesNotExist" } } });
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("unknown parameter", result.Error);
        Assert.Contains("doesNotExist", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithBodyEmptyPropertyName_Fails()
    {
        var invalid = ApiConfigWithBody(
            new ApiBodyObject { Properties = new Dictionary<string, ApiBodyNode> { [" "] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.String, StringValue = "x" } } });
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Property name", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithStringLiteralMissingStringValue_Fails()
    {
        var invalid = ApiConfigWithBody(
            new ApiBodyObject { Properties = new Dictionary<string, ApiBodyNode> { ["x"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.String } } });
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("String", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithNumberLiteralMissingNumberValue_Fails()
    {
        var invalid = ApiConfigWithBody(
            new ApiBodyObject { Properties = new Dictionary<string, ApiBodyNode> { ["x"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.Number } } });
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Number", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithBooleanLiteralMissingBoolValue_Fails()
    {
        var invalid = ApiConfigWithBody(
            new ApiBodyObject { Properties = new Dictionary<string, ApiBodyNode> { ["x"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.Boolean } } });
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Boolean", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithNullLiteralHavingAValueSet_Fails()
    {
        var invalid = ApiConfigWithBody(
            new ApiBodyObject { Properties = new Dictionary<string, ApiBodyNode> { ["x"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.Null, StringValue = "oops" } } });
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("Null", result.Error);
    }

    [Fact]
    public void Validate_ApiConfigWithValidLiteralOfEveryKind_Succeeds()
    {
        var valid = ApiConfigWithBody(new ApiBodyObject
        {
            Properties = new Dictionary<string, ApiBodyNode>
            {
                ["s"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.String, StringValue = "x" },
                ["n"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.Number, NumberValue = 1 },
                ["b"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.Boolean, BoolValue = true },
                ["nil"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.Null },
            },
        });
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    // A parameter referenced only from the body — never from the
    // UrlTemplate at all — must not be flagged as "unused": the unused-
    // parameter check (originally UrlTemplate-only) now also looks at the
    // body tree, see ValidateApiConfig.
    [Fact]
    public void Validate_ApiConfigWithParameterOnlyReferencedByBody_Succeeds()
    {
        var valid = new ApiConfig
        {
            Method = "POST",
            UrlTemplate = "https://example.com/api/search",
            ItemsPath = "data.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "search", Source = new StaticListSource { Values = ["a"] } }],
            Body = new ApiBodyObject { Properties = new Dictionary<string, ApiBodyNode> { ["term"] = new ApiBodyVariable { ParameterName = "search" } } },
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    // Concretizes the case that actually motivated a typed body tree (see
    // ApiBodyNode's doc comment): a GraphQL body is just an ordinary
    // ApiBodyObject with a fixed "query" string and a nested "variables"
    // object, requiring no dedicated GraphQL concept anywhere.
    [Fact]
    public void Validate_ApiConfigWithGraphQlShapedBody_Succeeds()
    {
        var valid = new ApiConfig
        {
            Method = "POST",
            UrlTemplate = "https://example.com/graphql",
            ItemsPath = "data.categoryProducts.items",
            Fields = [new ApiField { Name = "Titel", Path = "title" }],
            Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["electronics"] } }],
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
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ValidEmbeddedJsonSource_Succeeds()
    {
        var api = ValidApiConfig();
        var valid = new ApiConfig
        {
            UrlTemplate = "https://example.com/products",
            ItemsPath = api.ItemsPath,
            Fields = api.Fields,
            EmbeddedJsonSource = new EmbeddedJsonSource { ScriptSelector = "#__NEXT_DATA__" },
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    // Same "orthogonal to response shape" claim as Body/Groups above — an
    // embedded-JSON source works with the tree shape too, since it only
    // changes where the JSON to run Groups against comes from.
    [Fact]
    public void Validate_ValidEmbeddedJsonSourceWithGroupsTree_Succeeds()
    {
        var tree = ValidApiGroupsConfig();
        var valid = new ApiConfig
        {
            UrlTemplate = tree.UrlTemplate,
            Groups = tree.Groups,
            Parameters = tree.Parameters,
            EmbeddedJsonSource = new EmbeddedJsonSource { ScriptSelector = "script[type='application/json']" },
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(valid));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_EmbeddedJsonSourceWithBlankScriptSelector_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            UrlTemplate = api.UrlTemplate,
            ItemsPath = api.ItemsPath,
            Fields = api.Fields,
            EmbeddedJsonSource = new EmbeddedJsonSource { ScriptSelector = " " },
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("ScriptSelector", result.Error);
    }

    [Fact]
    public void Validate_EmbeddedJsonSourceWithPostMethod_Fails()
    {
        var api = ValidApiConfig();
        var invalid = new ApiConfig
        {
            Method = "POST",
            UrlTemplate = api.UrlTemplate,
            ItemsPath = api.ItemsPath,
            Fields = api.Fields,
            EmbeddedJsonSource = new EmbeddedJsonSource { ScriptSelector = "#__NEXT_DATA__" },
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("EmbeddedJsonSource", result.Error);
        Assert.Contains("GET", result.Error);
    }

    // A page load has no request body — since Body already requires
    // Method == "POST" (see the check above ValidateApiConfig's
    // EmbeddedJsonSource block), and EmbeddedJsonSource requires GET, the
    // two can never coexist: this combination is rejected via the same
    // "requires GET" error as a plain POST + EmbeddedJsonSource, with no
    // dedicated "Body" message needed.
    [Fact]
    public void Validate_EmbeddedJsonSourceWithBody_Fails()
    {
        var api = ValidApiConfigWithPostBody();
        var invalid = new ApiConfig
        {
            Method = "POST",
            UrlTemplate = api.UrlTemplate,
            ItemsPath = api.ItemsPath,
            Fields = api.Fields,
            Parameters = api.Parameters,
            Body = api.Body,
            EmbeddedJsonSource = new EmbeddedJsonSource { ScriptSelector = "#__NEXT_DATA__" },
        };
        var result = ScrapingPlanValidator.Validate(ApiPlan(invalid));
        Assert.False(result.Success);
        Assert.Contains("EmbeddedJsonSource", result.Error);
        Assert.Contains("GET", result.Error);
    }
}
