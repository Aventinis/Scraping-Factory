using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class PythonGroupCodeGeneratorTests
{
    private readonly PythonCodeGenerator _generator = new();

    private static ScrapingPlan NestedGroupPlan() => new()
    {
        Steps =
        [
            new NavigateStep { Urls = ["https://example.com/speisekarte"] },
            new ExtractGroupStep
            {
                Roots =
                [
                    new GroupNode
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
                ],
            },
        ],
    };

    [Fact]
    public void Generate_ContainsTargetUrl()
    {
        var script = _generator.Generate(NestedGroupPlan());
        Assert.Contains("https://example.com/speisekarte", script);
    }

    // Many sites (Wikipedia among them) reject the bare "python-requests/x.y"
    // default User-Agent with 403 Forbidden.
    [Fact]
    public void Generate_SendsUserAgentHeader()
    {
        var script = _generator.Generate(NestedGroupPlan());
        Assert.Contains("HEADERS = {\"User-Agent\":", script);
        Assert.Contains("requests.get(url, headers=HEADERS, timeout=10)", script);
    }

    // Issue #83
    [Fact]
    public void Generate_MultipleUrls_LoopsOverUrlsAndCombinesIntoOneErgebnis()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com/a", "https://example.com/b"] },
                new ExtractGroupStep
                {
                    Roots =
                    [
                        new GroupNode
                        {
                            Name = "Kategorie", Selector = "section", Repeating = true,
                            Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }],
                        },
                    ],
                },
            ],
        };

        var script = _generator.Generate(plan);

        Assert.Contains("""URLS = ["https://example.com/a", "https://example.com/b"]""", script);
        Assert.Contains("for url in URLS:", script);
        Assert.Contains("for el in scrape(url):", script);
        Assert.Contains("root.append(el)", script);
    }

    [Fact]
    public void Generate_ContainsGroupsLiteralWithNestedChildren()
    {
        var script = _generator.Generate(NestedGroupPlan());
        Assert.Contains("GROUPS = [", script);
        Assert.Contains("\"name\": 'Kategorie'", script);
        Assert.Contains("\"repeating\": True", script);
        Assert.Contains("\"name\": 'Gericht'", script);
    }

    [Fact]
    public void Generate_TextFieldHasTextModeAndNoAttributeKey()
    {
        var script = _generator.Generate(NestedGroupPlan());
        // "transform" (Issue #84) is always present, even when empty.
        Assert.Contains("{\"name\": 'Titel', \"selector\": 'h2', \"mode\": 'text', \"transform\": []}", script);
    }

    [Fact]
    public void Generate_AttributeFieldIncludesAttributeKey()
    {
        var script = _generator.Generate(NestedGroupPlan());
        Assert.Contains("\"mode\": 'attribute', \"attribute\": 'href'", script);
    }

    [Fact]
    public void Generate_ExistsFieldHasExistsMode()
    {
        var script = _generator.Generate(NestedGroupPlan());
        Assert.Contains("\"mode\": 'exists'", script);
    }

    [Fact]
    public void Generate_FieldWithTransforms_RendersTransformKeyAndRuntimeHelper()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com/speisekarte"] },
                new ExtractGroupStep
                {
                    Roots =
                    [
                        new GroupNode
                        {
                            Name = "Kategorie", Selector = "section", Repeating = true,
                            Children =
                            [
                                new DataFieldNode
                                {
                                    Name = "Preis", Selector = ".price",
                                    Transforms = [new TrimTransform(), new RegexExtractTransform { Pattern = @"[\d,]+", Group = 0 }, new ToNumberTransform()],
                                },
                            ],
                        },
                    ],
                },
            ],
        };

        var script = _generator.Generate(plan);
        Assert.Contains("""{"kind": "trim"}""", script);
        // PythonLiteral.Str escapes '\' to '\\', so the C# raw string's own
        // literal backslash (from @"[\d,]+") comes out doubled in the
        // generated Python source.
        Assert.Contains(""""kind": "regexExtract", "pattern": '[\\d,]+', "group": 0"""", script);
        Assert.Contains("""{"kind": "toNumber"}""", script);
        Assert.Contains("def _apply_transforms(value, transforms):", script);
    }

    [Fact]
    public void Generate_ContainsElementTreeImportAndXmlWrite()
    {
        var script = _generator.Generate(NestedGroupPlan());
        Assert.Contains("import xml.etree.ElementTree as ET", script);
        Assert.Contains("output.xml", script);
        Assert.DoesNotContain("output.csv", script);
    }

    [Fact]
    public void Generate_UsesConfiguredFileNames()
    {
        var plan = NestedGroupPlan();
        plan = new ScrapingPlan
        {
            Steps = plan.Steps, OutputFormat = plan.OutputFormat, Engine = plan.Engine,
            ScriptFileName = "speisekarte_scraper", OutputFileBaseName = "speisekarte",
        };

        var script = _generator.Generate(plan);

        Assert.Contains("python speisekarte_scraper.py", script);
        Assert.Contains("speisekarte.xml", script);
        Assert.DoesNotContain("output.xml", script);
    }

    [Fact]
    public void Generate_ContainsRecursiveExtractGroupFunction()
    {
        var script = _generator.Generate(NestedGroupPlan());
        Assert.Contains("def extract_group(scope, node):", script);
        Assert.Contains("scope.select(node[\"selector\"])", script);
        Assert.Contains("scope.select_one(node[\"selector\"])", script);
    }

    [Fact]
    public void Generate_DoesNotContainFlatFieldsScaffolding()
    {
        var script = _generator.Generate(NestedGroupPlan());
        Assert.DoesNotContain("SELECTORS = {", script);
        Assert.DoesNotContain("csv.DictWriter", script);
    }

    [Fact]
    public void Generate_EscapesSingleQuoteInName()
    {
        var plan = new ScrapingPlan
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
                            Name = "O'Briens",
                            Selector = "section",
                            Repeating = false,
                            Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }],
                        },
                    ],
                },
            ],
        };

        var script = _generator.Generate(plan);
        Assert.Contains(@"\'", script); // escaped quote inside the Python literal
    }

    [Fact]
    public void Generate_NonRepeatingGroupHasRepeatingFalse()
    {
        var plan = new ScrapingPlan
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
                            Name = "Header",
                            Selector = "header",
                            Repeating = false,
                            Children = [new DataFieldNode { Name = "Titel", Selector = "h1" }],
                        },
                    ],
                },
            ],
        };

        var script = _generator.Generate(plan);
        Assert.Contains("\"repeating\": False", script);
    }
}
