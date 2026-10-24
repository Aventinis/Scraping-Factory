using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Tests;

// The plan and config builders shared by the ScrapingPlanValidator*Tests classes.
internal static class ValidatorTestPlans
{
    internal static ScrapingPlan ValidPlan() => new()
    {
        Steps =
        [
            new NavigateStep { Urls = ["https://example.com"] },
            new ExtractStep { Name = "Titel", Selector = "h1" },
        ],
    };

    internal static ScrapingPlan BlocksPlan(params PlanExtractionBlock[] blocks) => new()
    {
        Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ExtractionBlockStep { Blocks = [.. blocks] }],
    };

    internal static PlanExtractionBlock FlatBlock(string name, string outputFileBaseName = "output") => new()
    {
        Name = name, OutputFileBaseName = outputFileBaseName, OutputFormat = OutputFormat.Csv,
        Fields = [new ExtractStep { Name = "Titel", Selector = "h1" }],
    };

    internal static ScrapingPlan FlatPlanWithBlueprint(OutputBlueprintMapping? blueprint) => new()
    {
        Steps =
        [
            new NavigateStep { Urls = ["https://example.com"] },
            new ExtractStep { Name = "Titel", Selector = "h1" },
            new ExtractStep { Name = "Preis", Selector = ".price" },
        ],
        OutputBlueprint = blueprint,
    };

    internal static ScrapingPlan GroupPlan(List<GroupNode> roots, ScrapingEngine engine = ScrapingEngine.Static) => new()
    {
        Engine = engine,
        Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ExtractGroupStep { Roots = roots }],
    };

    internal static ApiConfig ValidApiConfig() => new()
    {
        UrlTemplate = "https://example.com/api/items?category={category}",
        ItemsPath = "data.items",
        Fields = [new ApiField { Name = "Titel", Path = "title" }],
        Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
    };

    internal static ScrapingPlan ApiPlan(ApiConfig api) => new()
    {
        Engine = ScrapingEngine.Api,
        Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
    };

    internal static ApiConfig ValidApiGroupsConfig() => new()
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
                    new ApiField { Name = "KategorieName", Path = "name" },
                    new ApiGroup
                    {
                        Name = "Produkt",
                        Path = "products",
                        Children = [new ApiField { Name = "Titel", Path = "title" }],
                    },
                ],
            },
        ],
        Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
    };

    // ApiConfig isn't a record, so these build a fresh instance per test
    // instead of using `with` — UrlTemplate/Parameters copied verbatim from
    // ValidApiGroupsConfig(), only Groups varies per test.
    internal static ApiConfig WithGroups(List<ApiGroup> groups) => new()
    {
        UrlTemplate = ValidApiGroupsConfig().UrlTemplate,
        Groups = groups,
        Parameters = ValidApiGroupsConfig().Parameters,
    };

    internal static ApiConfig ApiConfigWithBody(ApiBodyNode body, List<ApiParameter>? parameters = null) => new()
    {
        Method = "POST",
        UrlTemplate = "https://example.com/api/items?category={category}",
        ItemsPath = "data.items",
        Fields = [new ApiField { Name = "Titel", Path = "title" }],
        Parameters = parameters ?? [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
        Body = body,
    };

    internal static ApiConfig ValidApiConfigWithPostBody() => ApiConfigWithBody(
        new ApiBodyObject
        {
            Properties = new Dictionary<string, ApiBodyNode>
            {
                ["query"] = new ApiBodyLiteral { Kind = ApiBodyLiteralKind.String, StringValue = "fixed" },
                ["term"] = new ApiBodyVariable { ParameterName = "search" },
            },
        },
        [
            new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } },
            new ApiParameter { Name = "search", Source = new StaticListSource { Values = ["b"] } },
        ]);

    internal static ScrapingPlan DedupFlatPlan(DeduplicationConfig dedup, OutputBlueprintMapping? blueprint = null) => new()
    {
        Steps =
        [
            new NavigateStep { Urls = ["https://example.com"] },
            new ExtractStep { Name = "Titel", Selector = "h1" },
            new ExtractStep { Name = "Preis", Selector = ".price" },
        ],
        Deduplication = dedup,
        OutputBlueprint = blueprint,
    };

    internal static ScrapingPlan DedupGroupPlan(DeduplicationConfig dedup, OutputBlueprintMapping? blueprint = null) => new()
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
                        Name = "Gericht", Selector = ".item", Repeating = true,
                        Children = [new DataFieldNode { Name = "Name", Selector = "h3" }],
                    },
                ],
            },
        ],
        OutputFormat = OutputFormat.Xml,
        Deduplication = dedup,
        OutputBlueprint = blueprint,
    };

    internal static ScrapingPlan PlanWithHeaders(params ApiHeader[] headers)
    {
        var plan = ValidPlan();
        return new ScrapingPlan { Steps = plan.Steps, Headers = [.. headers] };
    }

    internal static ScrapingPlan FlatPlanWithSelector(string selector) => new()
    {
        Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ExtractStep { Name = "F", Selector = selector }],
    };
}
