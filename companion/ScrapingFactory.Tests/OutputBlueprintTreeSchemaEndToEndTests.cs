using System.Diagnostics;
using System.Xml.Linq;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #244: real end-to-end proof that a tree-shaped Output Blueprint
// mapping builds an actual nested output tree — and, critically, that it
// succeeds for exactly the case #192's flat mapping rejects (two
// independent/sibling repeating source groups), by placing them under two
// different target branches instead of forcing one shared row scope. Same
// "run the real script, inspect the actual file" approach
// OutputBlueprintEndToEndTests already uses for the flat mapping, since a
// tree's actual shape isn't observable through PythonScriptVerifier's own
// row/element-count-only success check.
public class OutputBlueprintTreeSchemaEndToEndTests
{
    private static async Task<(int ExitCode, string Stderr)> RunScriptAsync(string scriptPath, string workDir)
    {
        Exception? lastError = null;
        foreach (var candidate in new[] { "python3", "python" })
        {
            var psi = new ProcessStartInfo
            {
                FileName = candidate,
                WorkingDirectory = workDir,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add(scriptPath);

            try
            {
                using var process = new Process { StartInfo = psi };
                process.Start();
                var stderrTask = process.StandardError.ReadToEndAsync();
                var stdoutTask = process.StandardOutput.ReadToEndAsync();
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                await process.WaitForExitAsync(cts.Token);
                return (process.ExitCode, await stderrTask);
            }
            catch (System.ComponentModel.Win32Exception ex)
            {
                lastError = ex; // executable not found — try the next candidate
            }
        }
        throw new InvalidOperationException("No Python interpreter found (tried: python3, python).", lastError);
    }

    private static async Task<(int Exit, string Stderr, XDocument Output)> GenerateRunAndReadXmlOutputAsync(ScrapingPlan plan, ICodeGenerator generator)
    {
        var script = generator.Generate(plan);
        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-blueprint-tree-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir);
            var outputPath = Path.Combine(workDir, "output.xml");
            var doc = File.Exists(outputPath) ? XDocument.Load(outputPath) : new XDocument(new XElement("Ergebnis"));
            return (exit, stderr, doc);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    private static OutputBlueprintMapping TreeMapping(params OutputBlueprintTreeMappingNode[] roots) =>
        new() { SchemaKind = OutputBlueprintSchemaKind.Tree, Tree = new List<OutputBlueprintTreeMappingNode>(roots) };

    // The "Speise-Art" case #192 handles (a category broadcast into every
    // nested dish row) PLUS a completely independent, sibling repeating
    // source group ("Zutat") that #192's flat mapping would reject outright
    // — mapped here into its own separate target branch ("Zutaten") instead.
    [Fact]
    public async Task ContainerMode_TreeMapping_IndependentSiblingRepeatingGroups_BuildsSeparateBranches()
    {
        using var server = new LocalTestServer(
            "<html><body>"
            + "<div class='kategorie'><span class='kat-name'>Vorspeisen</span>"
            + "<div class='gericht'><span class='g-name'>Suppe</span><span class='preis'>5</span></div>"
            + "<div class='gericht'><span class='g-name'>Salat</span><span class='preis'>6</span></div>"
            + "</div>"
            + "<div class='zutat'><span class='z-name'>Tomate</span></div>"
            + "<div class='zutat'><span class='z-name'>Kaese</span></div>"
            + "</body></html>");

        var kategorie = new GroupNode
        {
            Name = "Kategorie", Selector = ".kategorie", Repeating = true,
            Children =
            [
                new DataFieldNode { Name = "KategorieName", Selector = ".kat-name" },
                new GroupNode
                {
                    Name = "Gericht", Selector = ".gericht", Repeating = true,
                    Children =
                    [
                        new DataFieldNode { Name = "GerichtName", Selector = ".g-name" },
                        new DataFieldNode { Name = "Preis", Selector = ".preis" },
                    ],
                },
            ],
        };
        var zutat = new GroupNode
        {
            Name = "Zutat", Selector = ".zutat", Repeating = true,
            Children = [new DataFieldNode { Name = "ZutatName", Selector = ".z-name" }],
        };

        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractGroupStep { Roots = [kategorie, zutat] }],
            OutputBlueprint = TreeMapping(
                new OutputBlueprintTreeMappingGroup
                {
                    Name = "Kategorien",
                    Children =
                    [
                        new OutputBlueprintTreeMappingField { Name = "Name", SourceField = "KategorieName" },
                        new OutputBlueprintTreeMappingGroup
                        {
                            Name = "Gerichte",
                            Children =
                            [
                                new OutputBlueprintTreeMappingField { Name = "Name", SourceField = "GerichtName" },
                                new OutputBlueprintTreeMappingField { Name = "Preis", SourceField = "Preis" },
                            ],
                        },
                    ],
                },
                new OutputBlueprintTreeMappingGroup
                {
                    Name = "Zutaten",
                    Children = [new OutputBlueprintTreeMappingField { Name = "Name", SourceField = "ZutatName" }],
                }),
        };

        var (exit, stderr, output) = await GenerateRunAndReadXmlOutputAsync(plan, new PythonCodeGenerator());

        Assert.Equal(0, exit);
        Assert.Empty(stderr);

        var kategorien = output.Root!.Elements("Kategorien").ToList();
        Assert.Single(kategorien);
        Assert.Equal("Vorspeisen", kategorien[0].Element("Name")!.Value);
        var gerichte = kategorien[0].Elements("Gerichte").ToList();
        Assert.Equal(2, gerichte.Count);
        Assert.Equal("Suppe", gerichte[0].Element("Name")!.Value);
        Assert.Equal("5", gerichte[0].Element("Preis")!.Value);
        Assert.Equal("Salat", gerichte[1].Element("Name")!.Value);
        Assert.Equal("6", gerichte[1].Element("Preis")!.Value);

        var zutaten = output.Root!.Elements("Zutaten").ToList();
        Assert.Equal(2, zutaten.Count);
        Assert.Equal("Tomate", zutaten[0].Element("Name")!.Value);
        Assert.Equal("Kaese", zutaten[1].Element("Name")!.Value);
    }

    // Two direct leaf fields under the SAME target group, mapped from two
    // independent/sibling source repeating groups — unlike the test above,
    // there's no separate target branch to disambiguate them here, so this
    // is still rejected, exactly like #192's flat mapping already is.
    [Fact]
    public void ContainerMode_TreeMapping_AmbiguousFieldsUnderOneTargetGroup_FailsValidation()
    {
        var root = new GroupNode
        {
            Name = "Gericht", Selector = ".dish", Repeating = false,
            Children =
            [
                new GroupNode
                {
                    Name = "Zutat", Selector = ".ingredient", Repeating = true,
                    Children = [new DataFieldNode { Name = "ZutatName", Selector = ".name" }],
                },
                new GroupNode
                {
                    Name = "Beilage", Selector = ".side", Repeating = true,
                    Children = [new DataFieldNode { Name = "BeilageName", Selector = ".name" }],
                },
            ],
        };
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ExtractGroupStep { Roots = [root] }],
            OutputBlueprint = TreeMapping(new OutputBlueprintTreeMappingGroup
            {
                Name = "Beilagen",
                Children =
                [
                    new OutputBlueprintTreeMappingField { Name = "Zutat", SourceField = "ZutatName" },
                    new OutputBlueprintTreeMappingField { Name = "Beilage", SourceField = "BeilageName" },
                ],
            }),
        };

        var result = ScrapingPlanValidator.Validate(plan);

        Assert.False(result.Success);
        Assert.Contains("independent repeating group", result.Error);
    }

    // Same independent-sibling-branches shape as the static-engine test
    // above, proving playwright_scraper_grouped.py.j2's own mirror
    // (_resolve_group_matches-based) behaves identically.
    [Fact]
    public async Task BrowserEngine_ContainerMode_TreeMapping_IndependentSiblingRepeatingGroups_BuildsSeparateBranches()
    {
        using var server = new LocalTestServer(
            "<html><body>"
            + "<div class='kategorie'><span class='kat-name'>Desserts</span>"
            + "<div class='gericht'><span class='g-name'>Kaiserschmarrn</span></div>"
            + "</div>"
            + "<div class='zutat'><span class='z-name'>Zucker</span></div>"
            + "</body></html>");

        var kategorie = new GroupNode
        {
            Name = "Kategorie", Selector = ".kategorie", Repeating = true,
            Children =
            [
                new DataFieldNode { Name = "KategorieName", Selector = ".kat-name" },
                new GroupNode
                {
                    Name = "Gericht", Selector = ".gericht", Repeating = true,
                    Children = [new DataFieldNode { Name = "GerichtName", Selector = ".g-name" }],
                },
            ],
        };
        var zutat = new GroupNode
        {
            Name = "Zutat", Selector = ".zutat", Repeating = true,
            Children = [new DataFieldNode { Name = "ZutatName", Selector = ".z-name" }],
        };

        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractGroupStep { Roots = [kategorie, zutat] }],
            OutputBlueprint = TreeMapping(
                new OutputBlueprintTreeMappingGroup
                {
                    Name = "Kategorien",
                    Children =
                    [
                        new OutputBlueprintTreeMappingField { Name = "Name", SourceField = "KategorieName" },
                        new OutputBlueprintTreeMappingGroup
                        {
                            Name = "Gerichte",
                            Children = [new OutputBlueprintTreeMappingField { Name = "Name", SourceField = "GerichtName" }],
                        },
                    ],
                },
                new OutputBlueprintTreeMappingGroup
                {
                    Name = "Zutaten",
                    Children = [new OutputBlueprintTreeMappingField { Name = "Name", SourceField = "ZutatName" }],
                }),
        };

        var (exit, stderr, output) = await GenerateRunAndReadXmlOutputAsync(plan, new PythonPlaywrightCodeGenerator());

        Assert.Equal(0, exit);
        Assert.Empty(stderr);
        Assert.Equal("Desserts", output.Root!.Element("Kategorien")!.Element("Name")!.Value);
        Assert.Equal("Kaiserschmarrn", output.Root!.Element("Kategorien")!.Element("Gerichte")!.Element("Name")!.Value);
        Assert.Equal("Zucker", output.Root!.Element("Zutaten")!.Element("Name")!.Value);
    }

    // Api mode's own equivalent of the container-mode test above — proving
    // scraper_api_grouped.py.j2's dynamic, per-target-group row-scope
    // resolution succeeds for exactly the case its own FLAT mapping's
    // runtime RuntimeError (ApiTree_BlueprintMapping_
    // AmbiguousSiblingRepeatingGroups_FailsAtRuntime, in
    // OutputBlueprintEndToEndTests) rejects.
    [Fact]
    public async Task ApiTree_TreeMapping_IndependentSiblingRepeatingGroups_BuildsSeparateBranches()
    {
        using var server = new LocalTestServer(_ => new LocalTestServerResponse(
            """{ "ingredients": [{"name": "Salz"}, {"name": "Pfeffer"}], "sides": [{"name": "Reis"}] }""", "application/json"));

        var api = new ApiConfig
        {
            UrlTemplate = server.BaseUrl,
            Groups =
            [
                new ApiGroup
                {
                    Name = "Zutat", Path = "ingredients",
                    Children = [new ApiField { Name = "ZutatName", Path = "name" }],
                },
                new ApiGroup
                {
                    Name = "Beilage", Path = "sides",
                    Children = [new ApiField { Name = "BeilageName", Path = "name" }],
                },
            ],
        };
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Api,
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ApiCallStep { Config = api }],
            OutputBlueprint = TreeMapping(
                new OutputBlueprintTreeMappingGroup
                {
                    Name = "Zutaten",
                    Children = [new OutputBlueprintTreeMappingField { Name = "Name", SourceField = "ZutatName" }],
                },
                new OutputBlueprintTreeMappingGroup
                {
                    Name = "Beilagen",
                    Children = [new OutputBlueprintTreeMappingField { Name = "Name", SourceField = "BeilageName" }],
                }),
        };

        var (exit, stderr, output) = await GenerateRunAndReadXmlOutputAsync(plan, new PythonApiCodeGenerator());

        Assert.Equal(0, exit);
        Assert.Empty(stderr);
        var zutaten = output.Root!.Elements("Zutaten").ToList();
        Assert.Equal(2, zutaten.Count);
        Assert.Equal("Salz", zutaten[0].Element("Name")!.Value);
        Assert.Equal("Pfeffer", zutaten[1].Element("Name")!.Value);
        var beilagen = output.Root!.Elements("Beilagen").ToList();
        Assert.Single(beilagen);
        Assert.Equal("Reis", beilagen[0].Element("Name")!.Value);
    }

    // Api mode's own tree shape has no static row-scope check (ApiGroup has
    // no explicit Repeating flag — Architecture Decision #6), so an
    // ambiguity WITHIN one target group's own direct fields is only ever
    // caught at real script run time, via _blueprint_resolve_group_chain's
    // own RuntimeError.
    [Fact]
    public async Task ApiTree_TreeMapping_AmbiguousFieldsUnderOneTargetGroup_FailsAtRuntime()
    {
        using var server = new LocalTestServer(_ => new LocalTestServerResponse(
            """{ "ingredients": [{"name": "Salz"}], "sides": [{"name": "Reis"}] }""", "application/json"));

        var api = new ApiConfig
        {
            UrlTemplate = server.BaseUrl,
            Groups =
            [
                new ApiGroup
                {
                    Name = "Zutat", Path = "ingredients",
                    Children = [new ApiField { Name = "ZutatName", Path = "name" }],
                },
                new ApiGroup
                {
                    Name = "Beilage", Path = "sides",
                    Children = [new ApiField { Name = "BeilageName", Path = "name" }],
                },
            ],
        };
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Api,
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ApiCallStep { Config = api }],
            OutputBlueprint = TreeMapping(new OutputBlueprintTreeMappingGroup
            {
                Name = "Beilagen",
                Children =
                [
                    new OutputBlueprintTreeMappingField { Name = "Zutat", SourceField = "ZutatName" },
                    new OutputBlueprintTreeMappingField { Name = "Beilage", SourceField = "BeilageName" },
                ],
            }),
        };

        var script = new PythonApiCodeGenerator().Generate(plan);
        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-blueprint-tree-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);

            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir);

            Assert.NotEqual(0, exit);
            Assert.Contains("independent repeating group", stderr);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }
}
