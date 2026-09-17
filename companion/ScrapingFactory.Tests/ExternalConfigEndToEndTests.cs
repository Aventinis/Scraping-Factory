using System.Diagnostics;
using System.Xml.Linq;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #178: real end-to-end proof that the sidecar XML config file actually
// self-creates, is re-read and applied on a later run, and turns a broken/
// stale file into a clean, dedicated-exit-code failure instead of a raw
// Python traceback — none of this is exercisable through PythonScriptVerifier
// alone, since /generate's trial run always starts from an empty temp
// directory (the bootstrap path only). Same RunScriptAsync pattern as the
// HardeningXEndToEndTests classes, for the same reason.
public class ExternalConfigEndToEndTests
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

    private static string ConfigPathFor(string scriptPath) => Path.ChangeExtension(scriptPath, null) + ".config.xml";

    [Fact]
    public async Task FlatMode_FirstRun_SelfBootstrapsConfigAndScrapesWithBakedDefaults()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel A</h1><span class='p'>9.99</span></body></html>");
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractStep { Name = "Titel", Selector = "h1" },
                new ExtractStep { Name = "Preis", Selector = ".p" },
            ],
            ExternalConfig = true,
        };
        var script = new PythonCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-extcfg-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);

            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir);

            Assert.Equal(0, exit);
            Assert.Empty(stderr);

            var configPath = ConfigPathFor(scriptPath);
            Assert.True(File.Exists(configPath));
            var xml = XDocument.Load(configPath);
            Assert.Equal("output", xml.Root!.Element("OutputFileName")!.Value);
            Assert.Equal(server.BaseUrl, xml.Root.Element("Urls")!.Elements("Url").Single().Value);
            var fieldNames = xml.Root.Element("Fields")!.Elements("Field").Select(f => f.Attribute("original")!.Value).ToList();
            Assert.Equal(["Titel", "Preis"], fieldNames);

            var lines = await File.ReadAllLinesAsync(Path.Combine(workDir, "output.csv"));
            Assert.Equal("Titel,Preis", lines[0]);
            Assert.Equal("Titel A,9.99", lines[1]);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task FlatMode_SecondRun_EditedConfig_OverridesUrlOutputFileNameAndFieldName()
    {
        using var serverA = new LocalTestServer("<html><body><h1>From A</h1></body></html>");
        using var serverB = new LocalTestServer("<html><body><h1>From B</h1></body></html>");
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [serverA.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
            ExternalConfig = true,
        };
        var script = new PythonCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-extcfg-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            var configPath = ConfigPathFor(scriptPath);

            var editedConfig = new XElement("ScrapingFactoryConfig",
                new XElement("OutputFileName", "custom"),
                new XElement("Urls", new XElement("Url", serverB.BaseUrl)),
                new XElement("Fields", new XElement("Field", new XAttribute("original", "Titel"), "Name")));
            await File.WriteAllTextAsync(configPath, new XDocument(editedConfig).ToString());

            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir);

            Assert.Equal(0, exit);
            Assert.Empty(stderr);
            Assert.False(File.Exists(Path.Combine(workDir, "output.csv")));
            var lines = await File.ReadAllLinesAsync(Path.Combine(workDir, "custom.csv"));
            Assert.Equal("Name", lines[0]); // renamed header, not "Titel"
            Assert.Equal("From B", lines[1]); // scraped serverB (the override), not serverA (the baked default)
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task FlatMode_MalformedXml_ExitsWithDedicatedCodeAndCleanMessage()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel A</h1></body></html>");
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
            ExternalConfig = true,
        };
        var script = new PythonCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-extcfg-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            await File.WriteAllTextAsync(ConfigPathFor(scriptPath), "<ScrapingFactoryConfig><Urls>not closed");

            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir);

            Assert.Equal(3, exit);
            Assert.Contains("ERROR", stderr);
            Assert.Contains("not valid XML", stderr);
            Assert.False(File.Exists(Path.Combine(workDir, "output.csv")));
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task FlatMode_FieldMissingOriginalAttribute_ExitsWithDedicatedCodeAndCleanMessage()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel A</h1></body></html>");
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
            ExternalConfig = true,
        };
        var script = new PythonCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-extcfg-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            var badConfig = new XElement("ScrapingFactoryConfig", new XElement("Fields", new XElement("Field", "Name")));
            await File.WriteAllTextAsync(ConfigPathFor(scriptPath), new XDocument(badConfig).ToString());

            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir);

            Assert.Equal(3, exit);
            Assert.Contains("ERROR", stderr);
            Assert.Contains("original", stderr);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task FlatMode_UnknownFieldReference_ExitsWithDedicatedCodeAndCleanMessage()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel A</h1></body></html>");
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = "h1" }],
            ExternalConfig = true,
        };
        var script = new PythonCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-extcfg-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            // A stale reference — e.g. the scraper was regenerated with a
            // different field name since this config file was created.
            var badConfig = new XElement("ScrapingFactoryConfig",
                new XElement("Fields", new XElement("Field", new XAttribute("original", "NoLongerExists"), "Renamed")));
            await File.WriteAllTextAsync(ConfigPathFor(scriptPath), new XDocument(badConfig).ToString());

            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir);

            Assert.Equal(3, exit);
            Assert.Contains("ERROR", stderr);
            Assert.Contains("NoLongerExists", stderr);
            Assert.Contains("regenerated", stderr);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task ContainerMode_BootstrapsUrlAndOutputFileNameOnly_NoFieldsSection()
    {
        using var server = new LocalTestServer("<html><body><div class='item'><h3>Dish A</h3></div></body></html>");
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
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
            ExternalConfig = true,
        };
        var script = new PythonCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-extcfg-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);

            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir);

            Assert.Equal(0, exit);
            Assert.Empty(stderr);

            var configPath = ConfigPathFor(scriptPath);
            var xml = XDocument.Load(configPath);
            Assert.Equal("output", xml.Root!.Element("OutputFileName")!.Value);
            Assert.Equal(server.BaseUrl, xml.Root.Element("Urls")!.Elements("Url").Single().Value);
            // Container-mode group/field names aren't editable this way (yet)
            // — no <Fields> section at all, unlike the flat-mode bootstrap.
            Assert.Null(xml.Root.Element("Fields"));

            // Overriding just the output filename still works the same way
            // as flat mode.
            var editedConfig = new XElement("ScrapingFactoryConfig", new XElement("OutputFileName", "gerichte"));
            await File.WriteAllTextAsync(configPath, new XDocument(editedConfig).ToString());
            var (exit2, stderr2) = await RunScriptAsync(scriptPath, workDir);
            Assert.Equal(0, exit2);
            Assert.Empty(stderr2);
            Assert.True(File.Exists(Path.Combine(workDir, "gerichte.xml")));
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task ApiMode_SecondRun_EditedStaticListValues_ChangesRequestedParameterValues()
    {
        using var server = new LocalTestServer(_ => new LocalTestServerResponse("""[{"id": "x"}]""", "application/json"));
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Api,
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ApiCallStep
                {
                    Config = new ApiConfig
                    {
                        UrlTemplate = $"{server.BaseUrl}?category={{category}}",
                        Parameters = [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a", "b"] } }],
                        ItemsPath = "",
                        Fields = [new ApiField { Name = "Id", Path = "id" }],
                    },
                },
            ],
            ExternalConfig = true,
        };
        var script = new PythonApiCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-extcfg-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);

            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir);
            Assert.Equal(0, exit);
            Assert.Empty(stderr);

            var configPath = ConfigPathFor(scriptPath);
            var bootstrapXml = XDocument.Load(configPath);
            var bootstrapValues = bootstrapXml.Root!.Element("ApiParameters")!.Elements("Parameter")
                .Single(p => p.Attribute("name")!.Value == "category").Elements("Value").Select(v => v.Value).ToList();
            Assert.Equal(["a", "b"], bootstrapValues);

            var firstRunLines = await File.ReadAllLinesAsync(Path.Combine(workDir, "output.csv"));
            Assert.Equal(3, firstRunLines.Length); // header + 2 combos (a, b)

            var editedConfig = new XElement("ScrapingFactoryConfig",
                new XElement("ApiParameters",
                    new XElement("Parameter", new XAttribute("name", "category"),
                        new XElement("Value", "c"), new XElement("Value", "d"), new XElement("Value", "e"))));
            await File.WriteAllTextAsync(configPath, new XDocument(editedConfig).ToString());

            var (exit2, stderr2) = await RunScriptAsync(scriptPath, workDir);
            Assert.Equal(0, exit2);
            Assert.Empty(stderr2);

            var secondRunLines = await File.ReadAllLinesAsync(Path.Combine(workDir, "output.csv"));
            Assert.Equal(4, secondRunLines.Length); // header + 3 combos (c, d, e)
            Assert.Contains(secondRunLines, l => l.StartsWith("c,"));
            Assert.Contains(secondRunLines, l => l.StartsWith("d,"));
            Assert.Contains(secondRunLines, l => l.StartsWith("e,"));
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }
}
