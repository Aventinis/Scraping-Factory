using System.Diagnostics;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #191: real end-to-end proof that an Output Blueprint mapping
// actually reshapes the generated script's output — the same "run the real
// script, inspect the actual file" approach TypeConversionTransformEndToEndTests
// already uses, since a column's actual name/order isn't observable through
// PythonScriptVerifier's own row-count-only success check.
public class OutputBlueprintEndToEndTests
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

    private static async Task<string[]> RunAndReadOutputCsvAsync(ScrapingPlan plan, ICodeGenerator generator)
    {
        var script = generator.Generate(plan);
        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-blueprint-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);

            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir);
            Assert.Equal(0, exit);
            Assert.Empty(stderr);

            return await File.ReadAllLinesAsync(Path.Combine(workDir, "output.csv"));
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task Static_FlatMode_BlueprintMapping_RenamesReordersAndDropsColumns()
    {
        using var server = new LocalTestServer(
            "<html><body><div class='item'><h1>Suppe</h1><span class='price'>4.50</span><span class='extra'>ignored</span></div></body></html>");

        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractStep { Name = "Titel", Selector = ".item h1" },
                new ExtractStep { Name = "Preis", Selector = ".item .price" },
                new ExtractStep { Name = "Extra", Selector = ".item .extra" },
            ],
            // Blueprint order is deliberately the reverse of declaration
            // order, and "Extra" is left unmapped — both the rename+reorder
            // and the "unmapped source field is dropped" claims are
            // verified by the assertion below.
            OutputBlueprint = new OutputBlueprintMapping
            {
                Fields =
                [
                    new OutputBlueprintFieldMapping { TargetField = "cost", SourceField = "Preis" },
                    new OutputBlueprintFieldMapping { TargetField = "name", SourceField = "Titel" },
                ],
            },
        };

        var lines = await RunAndReadOutputCsvAsync(plan, new PythonCodeGenerator());

        Assert.Equal("cost,name", lines[0]);
        Assert.Equal("4.50,Suppe", lines[1]);
    }

    [Fact]
    public async Task ApiFlat_BlueprintMapping_RenamesReordersAndDropsColumns()
    {
        using var server = new LocalTestServer(_ => new LocalTestServerResponse(
            """{"data": {"items": [{"title": "Suppe", "price": "4.50", "sku": "X1"}]}}""", "application/json"));

        var api = new ApiConfig
        {
            UrlTemplate = server.BaseUrl,
            ItemsPath = "data.items",
            Fields =
            [
                new ApiField { Name = "Titel", Path = "title" },
                new ApiField { Name = "Preis", Path = "price" },
                new ApiField { Name = "Sku", Path = "sku" },
            ],
        };
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Api,
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ApiCallStep { Config = api }],
            OutputBlueprint = new OutputBlueprintMapping
            {
                Fields =
                [
                    new OutputBlueprintFieldMapping { TargetField = "cost", SourceField = "Preis" },
                    new OutputBlueprintFieldMapping { TargetField = "name", SourceField = "Titel" },
                ],
            },
        };

        var lines = await RunAndReadOutputCsvAsync(plan, new PythonApiCodeGenerator());

        Assert.Equal("cost,name", lines[0]);
        Assert.Equal("4.50,Suppe", lines[1]);
    }

    // Issue #192: container mode's own worked example (the "Speise-Art"
    // case from the issue discussion) — Gruppe > Speise-Art (single) +
    // Speise (repeating) > Name/Preis. One row per Speise, with the
    // Gruppe-level Speise-Art copied into every one of them, not written
    // once.
    [Fact]
    public async Task ContainerMode_BlueprintMapping_BroadcastsHigherLevelFieldIntoEveryRow()
    {
        using var server = new LocalTestServer(
            "<html><body><div class='group'>"
            + "<h2>Desserts</h2>"
            + "<div class='item'><h3>Kaiserschmarrn</h3><span class='price'>9,80 €</span></div>"
            + "<div class='item'><h3>Crème brûlée</h3><span class='price'>7,90 €</span></div>"
            + "</div></body></html>");

        var root = new GroupNode
        {
            Name = "Gruppe", Selector = ".group", Repeating = true,
            Children =
            [
                new DataFieldNode { Name = "SpeiseArt", Selector = "h2" },
                new GroupNode
                {
                    Name = "Speise", Selector = ".item", Repeating = true,
                    Children =
                    [
                        new DataFieldNode { Name = "Name", Selector = "h3" },
                        new DataFieldNode { Name = "Preis", Selector = ".price" },
                    ],
                },
            ],
        };
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractGroupStep { Roots = [root] }],
            OutputBlueprint = new OutputBlueprintMapping
            {
                Fields =
                [
                    new OutputBlueprintFieldMapping { TargetField = "category", SourceField = "SpeiseArt" },
                    new OutputBlueprintFieldMapping { TargetField = "name", SourceField = "Name" },
                    new OutputBlueprintFieldMapping { TargetField = "price", SourceField = "Preis" },
                ],
            },
        };

        var lines = await RunAndReadOutputCsvAsync(plan, new PythonCodeGenerator());

        // The price values contain a comma (German decimal format) — CSV
        // quotes any field containing the delimiter, per csv.DictWriter's
        // own default dialect.
        Assert.Equal("category,name,price", lines[0]);
        Assert.Equal("Desserts,Kaiserschmarrn,\"9,80 €\"", lines[1]);
        Assert.Equal("Desserts,Crème brûlée,\"7,90 €\"", lines[2]);
        Assert.Equal(3, lines.Length); // header + exactly 2 rows, one per Speise
    }

    // Two independent repeating groups (Zutat/Beilage), both siblings under
    // one Gericht, each holding a mapped field — there is no single row
    // layout that includes both without a cross-product or dropping data,
    // so this is rejected at generate time (before any script even runs).
    [Fact]
    public void ContainerMode_BlueprintMapping_AmbiguousSiblingRepeatingGroups_FailsValidation()
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
            OutputBlueprint = new OutputBlueprintMapping
            {
                Fields =
                [
                    new OutputBlueprintFieldMapping { TargetField = "ingredient", SourceField = "ZutatName" },
                    new OutputBlueprintFieldMapping { TargetField = "side", SourceField = "BeilageName" },
                ],
            },
        };

        var result = ScrapingPlanValidator.Validate(plan);

        Assert.False(result.Success);
        Assert.Contains("independent repeating group", result.Error);
    }

    // Same broadcast case as the static-engine test above, proving
    // playwright_scraper_grouped.py.j2's own mirror of
    // _flatten_group_tree_for_blueprint (using _resolve_group_matches/
    // _resolve_field_match instead of BeautifulSoup's select/select_one)
    // behaves identically.
    [Fact]
    public async Task BrowserEngine_ContainerMode_BlueprintMapping_BroadcastsHigherLevelFieldIntoEveryRow()
    {
        using var server = new LocalTestServer(
            "<html><body><div class='group'>"
            + "<h2>Desserts</h2>"
            + "<div class='item'><h3>Kaiserschmarrn</h3><span class='price'>9.80</span></div>"
            + "<div class='item'><h3>Creme brulee</h3><span class='price'>7.90</span></div>"
            + "</div></body></html>");

        var root = new GroupNode
        {
            Name = "Gruppe", Selector = ".group", Repeating = true,
            Children =
            [
                new DataFieldNode { Name = "SpeiseArt", Selector = "h2" },
                new GroupNode
                {
                    Name = "Speise", Selector = ".item", Repeating = true,
                    Children =
                    [
                        new DataFieldNode { Name = "Name", Selector = "h3" },
                        new DataFieldNode { Name = "Preis", Selector = ".price" },
                    ],
                },
            ],
        };
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractGroupStep { Roots = [root] }],
            OutputBlueprint = new OutputBlueprintMapping
            {
                Fields =
                [
                    new OutputBlueprintFieldMapping { TargetField = "category", SourceField = "SpeiseArt" },
                    new OutputBlueprintFieldMapping { TargetField = "name", SourceField = "Name" },
                    new OutputBlueprintFieldMapping { TargetField = "price", SourceField = "Preis" },
                ],
            },
        };

        var lines = await RunAndReadOutputCsvAsync(plan, new PythonPlaywrightCodeGenerator());

        Assert.Equal("category,name,price", lines[0]);
        Assert.Equal("Desserts,Kaiserschmarrn,9.80", lines[1]);
        Assert.Equal("Desserts,Creme brulee,7.90", lines[2]);
        Assert.Equal(3, lines.Length);
    }

    // Same broadcast case again, this time for Api mode's own tree shape —
    // proving scraper_api_grouped.py.j2's runtime mirror of the companion's
    // row-scope resolution (necessarily dynamic here, see
    // _flatten_api_group_for_blueprint's own doc comment) produces the
    // identical result once ApiGroup's own repeating-ness is resolved from
    // the real response.
    [Fact]
    public async Task ApiTree_BlueprintMapping_BroadcastsHigherLevelFieldIntoEveryRow()
    {
        using var server = new LocalTestServer(_ => new LocalTestServerResponse(
            """
            { "groups": [
                { "category": "Desserts", "items": [
                    { "name": "Kaiserschmarrn", "price": "9.80" },
                    { "name": "Creme brulee", "price": "7.90" }
                ] }
            ] }
            """, "application/json"));

        var api = new ApiConfig
        {
            UrlTemplate = server.BaseUrl,
            Groups =
            [
                new ApiGroup
                {
                    Name = "Gruppe", Path = "groups",
                    Children =
                    [
                        new ApiField { Name = "SpeiseArt", Path = "category" },
                        new ApiGroup
                        {
                            Name = "Speise", Path = "items",
                            Children = [new ApiField { Name = "Name", Path = "name" }, new ApiField { Name = "Preis", Path = "price" }],
                        },
                    ],
                },
            ],
        };
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Api,
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ApiCallStep { Config = api }],
            OutputBlueprint = new OutputBlueprintMapping
            {
                Fields =
                [
                    new OutputBlueprintFieldMapping { TargetField = "category", SourceField = "SpeiseArt" },
                    new OutputBlueprintFieldMapping { TargetField = "name", SourceField = "Name" },
                    new OutputBlueprintFieldMapping { TargetField = "price", SourceField = "Preis" },
                ],
            },
        };

        var lines = await RunAndReadOutputCsvAsync(plan, new PythonApiCodeGenerator());

        Assert.Equal("category,name,price", lines[0]);
        Assert.Equal("Desserts,Kaiserschmarrn,9.80", lines[1]);
        Assert.Equal("Desserts,Creme brulee,7.90", lines[2]);
        Assert.Equal(3, lines.Length);
    }

    // Api mode's own equivalent of the container-mode ambiguity test above
    // — since ApiGroup's repeating-ness can't be checked statically (see
    // OutputBlueprintFlattening's own doc comment), this is only ever
    // caught at real script run time instead of generate-time validation,
    // via _flatten_api_group_for_blueprint's own RuntimeError.
    [Fact]
    public async Task ApiTree_BlueprintMapping_AmbiguousSiblingRepeatingGroups_FailsAtRuntime()
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
            OutputBlueprint = new OutputBlueprintMapping
            {
                Fields =
                [
                    new OutputBlueprintFieldMapping { TargetField = "ingredient", SourceField = "ZutatName" },
                    new OutputBlueprintFieldMapping { TargetField = "side", SourceField = "BeilageName" },
                ],
            },
        };

        var script = new PythonApiCodeGenerator().Generate(plan);
        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-blueprint-test-").FullName;
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
