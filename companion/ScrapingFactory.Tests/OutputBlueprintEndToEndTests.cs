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
}
