using System.Diagnostics;
using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #206: real end-to-end proof that CombineFieldsTransform/
// SplitFieldTransform actually produce the documented values at runtime,
// for both flat mode (a plain dict `row` as `siblings`) and container mode
// (the in-construction parent ET.Element as `siblings`) — the same "run the
// generated script for real, inspect the output file" approach
// TypeConversionTransformEndToEndTests already uses, since neither
// PythonScriptVerifier's row/element-count check nor ScrapingPlanValidator's
// own structural pre-check can observe an individual cell's actual value.
public class CombineSplitFieldTransformEndToEndTests
{
    private static async Task<(int ExitCode, string Stderr, string WorkDir)> GenerateAndRunAsync(ScrapingPlan plan, string tempPrefix)
    {
        var script = new PythonCodeGenerator().Generate(plan);
        var workDir = Directory.CreateTempSubdirectory(tempPrefix).FullName;
        var scriptPath = Path.Combine(workDir, "scraper.py");
        await File.WriteAllTextAsync(scriptPath, script);

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
                return (process.ExitCode, await stderrTask, workDir);
            }
            catch (System.ComponentModel.Win32Exception ex)
            {
                lastError = ex; // executable not found — try the next candidate
            }
        }
        throw new InvalidOperationException("No Python interpreter found (tried: python3, python).", lastError);
    }

    [Fact]
    public async Task FlatMode_CombineFields_JoinsEarlierFieldsValues()
    {
        using var server = new LocalTestServer(
            "<html><body><span class='street'>Musterstraße</span><span class='number'>12</span></body></html>");
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractStep { Name = "Strasse", Selector = ".street" },
                new ExtractStep { Name = "Hausnummer", Selector = ".number" },
                new ExtractStep
                {
                    Name = "Adresse", Selector = ".street", // own raw value is discarded
                    Transforms = [new CombineFieldsTransform { SourceFieldNames = ["Strasse", "Hausnummer"], Separator = " " }],
                },
            ],
        };

        var (exit, stderr, workDir) = await GenerateAndRunAsync(plan, "scrapingfactory-combine-flat-test-");
        try
        {
            Assert.Equal(0, exit);
            Assert.Empty(stderr);

            var lines = await File.ReadAllLinesAsync(Path.Combine(workDir, "output.csv"));
            Assert.Equal("Strasse,Hausnummer,Adresse", lines[0]);
            Assert.Equal("Musterstraße,12,Musterstraße 12", lines[1]);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task FlatMode_SplitField_TakesConfiguredPart()
    {
        using var server = new LocalTestServer(
            "<html><body><span class='address'>Musterstraße, 12</span></body></html>");
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractStep { Name = "Adresse", Selector = ".address" },
                new ExtractStep
                {
                    Name = "Strasse", Selector = ".address",
                    Transforms = [new SplitFieldTransform { SourceFieldName = "Adresse", Separator = ", ", Index = 0 }],
                },
                new ExtractStep
                {
                    Name = "Hausnummer", Selector = ".address",
                    Transforms = [new SplitFieldTransform { SourceFieldName = "Adresse", Separator = ", ", Index = 1 }],
                },
            ],
        };

        var (exit, stderr, workDir) = await GenerateAndRunAsync(plan, "scrapingfactory-split-flat-test-");
        try
        {
            Assert.Equal(0, exit);
            Assert.Empty(stderr);

            var lines = await File.ReadAllLinesAsync(Path.Combine(workDir, "output.csv"));
            Assert.Equal("Adresse,Strasse,Hausnummer", lines[0]);
            Assert.Equal("\"Musterstraße, 12\",Musterstraße,12", lines[1]);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task FlatMode_SplitField_OutOfRangeIndex_YieldsEmptyString()
    {
        using var server = new LocalTestServer("<html><body><span class='value'>onlyone</span></body></html>");
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractStep { Name = "Wert", Selector = ".value" },
                new ExtractStep
                {
                    Name = "ZweiterTeil", Selector = ".value",
                    Transforms = [new SplitFieldTransform { SourceFieldName = "Wert", Separator = ",", Index = 1 }],
                },
            ],
        };

        var (exit, stderr, workDir) = await GenerateAndRunAsync(plan, "scrapingfactory-split-outofrange-test-");
        try
        {
            Assert.Equal(0, exit);
            Assert.Empty(stderr);

            var lines = await File.ReadAllLinesAsync(Path.Combine(workDir, "output.csv"));
            Assert.Equal("Wert,ZweiterTeil", lines[0]);
            Assert.Equal("onlyone,", lines[1]);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    // Two repeating instances with different sibling values each, proving
    // the combine transform reads *this instance's own* siblings (via the
    // in-construction parent ET.Element), not some other instance's or a
    // module-level leak from the flat-mode dict-based path.
    [Fact]
    public async Task ContainerMode_CombineFields_JoinsSiblingsWithinSameGroupInstance()
    {
        using var server = new LocalTestServer(
            "<html><body>" +
            "<div class='item'><span class='street'>Erste Straße</span><span class='number'>1</span></div>" +
            "<div class='item'><span class='street'>Zweite Straße</span><span class='number'>2</span></div>" +
            "</body></html>");
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
                            Name = "Item", Selector = ".item", Repeating = true,
                            Children =
                            [
                                new DataFieldNode { Name = "Strasse", Selector = ".street" },
                                new DataFieldNode { Name = "Hausnummer", Selector = ".number" },
                                new DataFieldNode
                                {
                                    Name = "Adresse", Selector = ".street",
                                    Transforms = [new CombineFieldsTransform { SourceFieldNames = ["Strasse", "Hausnummer"] }],
                                },
                            ],
                        },
                    ],
                },
            ],
        };

        var (exit, stderr, workDir) = await GenerateAndRunAsync(plan, "scrapingfactory-combine-container-test-");
        try
        {
            Assert.Equal(0, exit);
            Assert.Empty(stderr);

            var outputXml = await File.ReadAllTextAsync(Path.Combine(workDir, "output.xml"));
            var matches = Regex.Matches(outputXml, "<Adresse>(.*?)</Adresse>");
            Assert.Equal(2, matches.Count);
            Assert.Equal("Erste Straße 1", matches[0].Groups[1].Value);
            Assert.Equal("Zweite Straße 2", matches[1].Groups[1].Value);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    // Issue #206 follow-up: a combine/split-derived field created through the
    // extension's dedicated creation flow carries no Selector at all — proves
    // flat mode's own row-alignment restructuring (Selector is no longer part
    // of the columns/max-match-count zip) still produces a correct value for
    // *every* row, not just the first, when the real fields' own match counts
    // are themselves greater than one.
    [Fact]
    public async Task FlatMode_CombineFields_WithNullSelector_CombinesEveryRowCorrectly()
    {
        using var server = new LocalTestServer(
            "<html><body>" +
            "<div><span class='street'>Erste Straße</span><span class='number'>1</span></div>" +
            "<div><span class='street'>Zweite Straße</span><span class='number'>2</span></div>" +
            "</body></html>");
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractStep { Name = "Strasse", Selector = ".street" },
                new ExtractStep { Name = "Hausnummer", Selector = ".number" },
                new ExtractStep
                {
                    Name = "Adresse", Selector = null,
                    Transforms = [new CombineFieldsTransform { SourceFieldNames = ["Strasse", "Hausnummer"], Separator = " " }],
                },
            ],
        };

        var (exit, stderr, workDir) = await GenerateAndRunAsync(plan, "scrapingfactory-combine-noselector-test-");
        try
        {
            Assert.Equal(0, exit);
            Assert.Empty(stderr);

            var lines = await File.ReadAllLinesAsync(Path.Combine(workDir, "output.csv"));
            Assert.Equal("Strasse,Hausnummer,Adresse", lines[0]);
            Assert.Equal("Erste Straße,1,Erste Straße 1", lines[1]);
            Assert.Equal("Zweite Straße,2,Zweite Straße 2", lines[2]);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    // Issue #206 follow-up: HiddenFromOutput — the source fields are still
    // computed (so the combine transform can read them) but must not appear
    // as their own output columns.
    [Fact]
    public async Task FlatMode_HiddenFromOutput_ExcludesFieldFromOutputButStillCombines()
    {
        using var server = new LocalTestServer(
            "<html><body><span class='street'>Musterstraße</span><span class='number'>12</span></body></html>");
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractStep { Name = "Strasse", Selector = ".street", HiddenFromOutput = true },
                new ExtractStep { Name = "Hausnummer", Selector = ".number", HiddenFromOutput = true },
                new ExtractStep
                {
                    Name = "Adresse", Selector = null,
                    Transforms = [new CombineFieldsTransform { SourceFieldNames = ["Strasse", "Hausnummer"], Separator = " " }],
                },
            ],
        };

        var (exit, stderr, workDir) = await GenerateAndRunAsync(plan, "scrapingfactory-hidden-flat-test-");
        try
        {
            Assert.Equal(0, exit);
            Assert.Empty(stderr);

            var lines = await File.ReadAllLinesAsync(Path.Combine(workDir, "output.csv"));
            Assert.Equal("Adresse", lines[0]);
            Assert.Equal("Musterstraße 12", lines[1]);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    // Issue #206 follow-up: same HiddenFromOutput proof for container mode —
    // the hidden field's own element must be stripped from the written XML
    // while still contributing its value to the combine transform.
    [Fact]
    public async Task ContainerMode_HiddenFromOutput_ExcludesElementFromOutputButStillCombines()
    {
        using var server = new LocalTestServer(
            "<html><body><div class='item'><span class='street'>Musterstraße</span><span class='number'>12</span></div></body></html>");
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
                            Name = "Item", Selector = ".item", Repeating = true,
                            Children =
                            [
                                new DataFieldNode { Name = "Strasse", Selector = ".street", HiddenFromOutput = true },
                                new DataFieldNode { Name = "Hausnummer", Selector = ".number", HiddenFromOutput = true },
                                new DataFieldNode
                                {
                                    Name = "Adresse", Selector = null,
                                    Transforms = [new CombineFieldsTransform { SourceFieldNames = ["Strasse", "Hausnummer"] }],
                                },
                            ],
                        },
                    ],
                },
            ],
        };

        var (exit, stderr, workDir) = await GenerateAndRunAsync(plan, "scrapingfactory-hidden-container-test-");
        try
        {
            Assert.Equal(0, exit);
            Assert.Empty(stderr);

            var outputXml = await File.ReadAllTextAsync(Path.Combine(workDir, "output.xml"));
            Assert.DoesNotContain("<Strasse>", outputXml);
            Assert.DoesNotContain("<Hausnummer>", outputXml);
            var matches = Regex.Matches(outputXml, "<Adresse>(.*?)</Adresse>");
            var match = Assert.Single(matches.Cast<Match>());
            Assert.Equal("Musterstraße 12", match.Groups[1].Value);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task ContainerMode_SplitField_TakesConfiguredPartPerInstance()
    {
        using var server = new LocalTestServer(
            "<html><body>" +
            "<div class='item'><span class='address'>Erste Straße, 1</span></div>" +
            "<div class='item'><span class='address'>Zweite Straße, 2</span></div>" +
            "</body></html>");
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
                            Name = "Item", Selector = ".item", Repeating = true,
                            Children =
                            [
                                new DataFieldNode { Name = "Adresse", Selector = ".address" },
                                new DataFieldNode
                                {
                                    Name = "Hausnummer", Selector = ".address",
                                    Transforms = [new SplitFieldTransform { SourceFieldName = "Adresse", Separator = ", ", Index = 1 }],
                                },
                            ],
                        },
                    ],
                },
            ],
        };

        var (exit, stderr, workDir) = await GenerateAndRunAsync(plan, "scrapingfactory-split-container-test-");
        try
        {
            Assert.Equal(0, exit);
            Assert.Empty(stderr);

            var outputXml = await File.ReadAllTextAsync(Path.Combine(workDir, "output.xml"));
            var matches = Regex.Matches(outputXml, "<Hausnummer>(.*?)</Hausnummer>");
            Assert.Equal(2, matches.Count);
            Assert.Equal("1", matches[0].Groups[1].Value);
            Assert.Equal("2", matches[1].Groups[1].Value);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }
}
