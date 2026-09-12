using System.Diagnostics;
using System.Xml.Linq;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #133: real end-to-end proof that RequiredFieldsCheck actually
// changes what gets written — unlike its four siblings (post-hoc checks
// evaluated after the output file is already final), this one filters rows
// *before* the write, so PythonScriptVerifier's own "did it produce data"
// check can't distinguish a filtered run from an unfiltered one; only
// running the generated script directly and inspecting both its own
// exit code/stderr and the actual output file content proves it. Same
// RunScriptAsync pattern as HardeningNullRateEndToEndTests/
// HardeningBlockingEndToEndTests, for the same reason. Static engine only
// (flat mode is engine-independent, but this check's own Scriban syntax is
// already covered for the Browser engine by CompanionEndpointTests' round-
// trip test — a full behavioral proof doesn't need repeating per engine).
public class HardeningRequiredFieldsEndToEndTests
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

    private static async Task<(int Exit, string Stderr, string[] OutputLines)> GenerateRunAndReadOutputAsync(ScrapingPlan plan)
    {
        var script = new PythonCodeGenerator().Generate(plan);
        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-required-fields-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir);
            var outputPath = Path.Combine(workDir, "output.csv");
            var lines = File.Exists(outputPath) ? await File.ReadAllLinesAsync(outputPath) : [];
            return (exit, stderr, lines);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task RowMissingRequiredField_DroppedFromOutput_ErrorSeverityExitsWithHardeningCode()
    {
        // Flat mode's extraction is positional (each field's own selector
        // is matched independently, page-wide, then zipped by index — see
        // scraper.py.j2's scrape()) rather than scoped per '.item' — so
        // every row needs the *same number* of .price elements, with an
        // empty one (not an omitted one) standing in for "missing", or the
        // whole column shifts out of alignment with Titel's own list.
        using var server = new LocalTestServer(
            "<html><body>"
            + "<div class='item'><h1>A</h1><span class='price'>1</span></div>"
            + "<div class='item'><h1>B</h1><span class='price'></span></div>" // empty .price -> Preis empty -> dropped
            + "<div class='item'><h1>C</h1><span class='price'>3</span></div>"
            + "</body></html>");

        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractStep { Name = "Titel", Selector = ".item h1" },
                new ExtractStep { Name = "Preis", Selector = ".price" },
            ],
            Hardening = [new RequiredFieldsCheck { Severity = HardeningSeverity.Error, FieldNames = ["Preis"] }],
        };

        var (exit, stderr, lines) = await GenerateRunAndReadOutputAsync(plan);

        Assert.Equal(2, exit);
        Assert.Contains("ERROR", stderr);
        Assert.Contains("Dropped 1 of 3 row(s) missing a required field.", stderr);
        Assert.Equal(3, lines.Length); // header + 2 surviving rows (B was dropped)
        Assert.DoesNotContain(lines, line => line.StartsWith("B,"));
    }

    [Fact]
    public async Task AllRowsComplete_NoDropAndExitsCleanly()
    {
        using var server = new LocalTestServer(
            "<html><body>"
            + "<div class='item'><h1>A</h1><span class='price'>1</span></div>"
            + "<div class='item'><h1>B</h1><span class='price'>2</span></div>"
            + "</body></html>");

        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractStep { Name = "Titel", Selector = ".item h1" },
                new ExtractStep { Name = "Preis", Selector = ".price" },
            ],
            Hardening = [new RequiredFieldsCheck { Severity = HardeningSeverity.Error, FieldNames = ["Preis"] }],
        };

        var (exit, stderr, lines) = await GenerateRunAndReadOutputAsync(plan);

        Assert.Equal(0, exit);
        Assert.Empty(stderr);
        Assert.Equal(3, lines.Length); // header + 2 rows, nothing dropped
    }

    // The core "safe for DB import" guarantee: even Warning severity (which
    // never fails the run) still guarantees the output file itself never
    // contains a row missing a required value — filtering is unconditional,
    // only whether the *run* is flagged as failed depends on severity.
    [Fact]
    public async Task WarningSeverity_StillDropsRowButExitsCleanly()
    {
        using var server = new LocalTestServer(
            "<html><body>"
            + "<div class='item'><h1>A</h1><span class='price'>1</span></div>"
            + "<div class='item'><h1>B</h1></div>"
            + "</body></html>");

        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractStep { Name = "Titel", Selector = ".item h1" },
                new ExtractStep { Name = "Preis", Selector = ".price" },
            ],
            Hardening = [new RequiredFieldsCheck { Severity = HardeningSeverity.Warning, FieldNames = ["Preis"] }],
        };

        var (exit, stderr, lines) = await GenerateRunAndReadOutputAsync(plan);

        Assert.Equal(0, exit); // Warning never fails the run
        Assert.Contains("WARNING", stderr);
        Assert.Contains("Dropped 1 of 2 row(s) missing a required field.", stderr);
        Assert.Equal(2, lines.Length); // header + 1 surviving row — still filtered
        Assert.DoesNotContain(lines, line => line.StartsWith("B,"));
    }

    // A row missing *any* of several required fields is dropped, not just
    // one specifically configured field.
    [Fact]
    public async Task RowMissingAnyOfMultipleRequiredFields_IsDropped()
    {
        using var server = new LocalTestServer(
            "<html><body>"
            + "<div class='item'><h1>A</h1><span class='price'>1</span><span class='qty'>5</span></div>"
            + "<div class='item'><h1>B</h1><span class='price'>2</span></div>" // missing .qty
            + "</body></html>");

        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractStep { Name = "Titel", Selector = ".item h1" },
                new ExtractStep { Name = "Preis", Selector = ".price" },
                new ExtractStep { Name = "Menge", Selector = ".qty" },
            ],
            Hardening = [new RequiredFieldsCheck { Severity = HardeningSeverity.Error, FieldNames = ["Preis", "Menge"] }],
        };

        var (exit, stderr, lines) = await GenerateRunAndReadOutputAsync(plan);

        Assert.Equal(2, exit);
        Assert.Contains("Dropped 1 of 2 row(s) missing a required field.", stderr);
        Assert.Equal(2, lines.Length); // header + 1 surviving row
    }

    // ── Container mode follow-up ────────────────────────────────────────

    private static async Task<(int Exit, string Stderr, XDocument Output)> GenerateRunAndReadXmlOutputAsync(ScrapingPlan plan)
    {
        var script = new PythonCodeGenerator().Generate(plan);
        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-required-fields-container-test-").FullName;
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

    // Single-level repeating group — the direct container-mode analogue of
    // the flat-mode test above, proving the same "drop the incomplete
    // instance, keep the rest" behavior for a tree instead of a list.
    [Fact]
    public async Task ContainerMode_InstanceMissingRequiredField_IsDropped()
    {
        using var server = new LocalTestServer(
            "<html><body>"
            + "<div class='item'><h3>A</h3><span class='price'>1</span></div>"
            + "<div class='item'><h3>B</h3><span class='price'></span></div>"
            + "<div class='item'><h3>C</h3><span class='price'>3</span></div>"
            + "</body></html>");

        var root = new GroupNode
        {
            Name = "Gericht", Selector = ".item", Repeating = true,
            Children =
            [
                new DataFieldNode { Name = "Name", Selector = "h3" },
                new DataFieldNode { Name = "Preis", Selector = ".price" },
            ],
        };
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractGroupStep { Roots = [root] }],
            OutputFormat = OutputFormat.Xml,
            Hardening = [new RequiredFieldsCheck { Severity = HardeningSeverity.Error, FieldNames = ["Preis"] }],
        };

        var (exit, stderr, output) = await GenerateRunAndReadXmlOutputAsync(plan);

        Assert.Equal(2, exit);
        Assert.Contains("ERROR", stderr);
        Assert.Contains("Dropped 1 element(s) missing a required field.", stderr);
        var gerichte = output.Root!.Elements("Gericht").ToList();
        Assert.Equal(2, gerichte.Count);
        Assert.DoesNotContain(gerichte, g => g.Element("Name")!.Value == "B");
    }

    // Two levels of nesting: Kategorie (repeating) > Gericht (repeating) >
    // Preis (required). Proves the check drops the *nearest enclosing*
    // repeating instance (the specific Gericht missing Preis), not the
    // outer Kategorie it happens to live in, and doesn't touch an unrelated
    // Kategorie's own Gerichte at all.
    [Fact]
    public async Task ContainerMode_NestedRepeatingGroups_DropsOnlyInnermostInstance()
    {
        using var server = new LocalTestServer(
            "<html><body>"
            + "<div class='category'><h2>Kat1</h2>"
            + "<div class='item'><h3>A</h3><span class='price'>1</span></div>"
            + "<div class='item'><h3>B</h3><span class='price'></span></div>"
            + "</div>"
            + "<div class='category'><h2>Kat2</h2>"
            + "<div class='item'><h3>C</h3><span class='price'>3</span></div>"
            + "</div>"
            + "</body></html>");

        var root = new GroupNode
        {
            Name = "Kategorie", Selector = ".category", Repeating = true,
            Children =
            [
                new DataFieldNode { Name = "KategorieName", Selector = "h2" },
                new GroupNode
                {
                    Name = "Gericht", Selector = ".item", Repeating = true,
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
            OutputFormat = OutputFormat.Xml,
            Hardening = [new RequiredFieldsCheck { Severity = HardeningSeverity.Error, FieldNames = ["Preis"] }],
        };

        var (exit, stderr, output) = await GenerateRunAndReadXmlOutputAsync(plan);

        Assert.Equal(2, exit);
        Assert.Contains("Dropped 1 element(s) missing a required field.", stderr);
        var kategorien = output.Root!.Elements("Kategorie").ToList();
        Assert.Equal(2, kategorien.Count); // neither Kategorie itself is dropped

        var kat1 = kategorien.Single(k => k.Element("KategorieName")!.Value == "Kat1");
        var kat1Gerichte = kat1.Elements("Gericht").ToList();
        Assert.Single(kat1Gerichte); // only A survives — B was dropped
        Assert.Equal("A", kat1Gerichte[0].Element("Name")!.Value);

        var kat2 = kategorien.Single(k => k.Element("KategorieName")!.Value == "Kat2");
        Assert.Single(kat2.Elements("Gericht")); // untouched
    }

    [Fact]
    public async Task ContainerMode_WarningSeverity_StillDropsInstanceButExitsCleanly()
    {
        using var server = new LocalTestServer(
            "<html><body>"
            + "<div class='item'><h3>A</h3><span class='price'>1</span></div>"
            + "<div class='item'><h3>B</h3><span class='price'></span></div>"
            + "</body></html>");

        var root = new GroupNode
        {
            Name = "Gericht", Selector = ".item", Repeating = true,
            Children =
            [
                new DataFieldNode { Name = "Name", Selector = "h3" },
                new DataFieldNode { Name = "Preis", Selector = ".price" },
            ],
        };
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractGroupStep { Roots = [root] }],
            OutputFormat = OutputFormat.Xml,
            Hardening = [new RequiredFieldsCheck { Severity = HardeningSeverity.Warning, FieldNames = ["Preis"] }],
        };

        var (exit, stderr, output) = await GenerateRunAndReadXmlOutputAsync(plan);

        Assert.Equal(0, exit); // Warning never fails the run
        Assert.Contains("WARNING", stderr);
        Assert.Single(output.Root!.Elements("Gericht")); // still filtered
    }

    // A required field name matching nothing anywhere in the tree (typo/
    // renamed field) is a silent no-op — same convention nullRate's own
    // zero-match case already uses.
    [Fact]
    public async Task ContainerMode_RequiredFieldNameMatchesNothing_IsANoOp()
    {
        using var server = new LocalTestServer(
            "<html><body><div class='item'><h3>A</h3></div></body></html>");

        var root = new GroupNode
        {
            Name = "Gericht", Selector = ".item", Repeating = true,
            Children = [new DataFieldNode { Name = "Name", Selector = "h3" }],
        };
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractGroupStep { Roots = [root] }],
            OutputFormat = OutputFormat.Xml,
            Hardening = [new RequiredFieldsCheck { Severity = HardeningSeverity.Error, FieldNames = ["DoesNotExist"] }],
        };

        var (exit, stderr, output) = await GenerateRunAndReadXmlOutputAsync(plan);

        Assert.Equal(0, exit);
        Assert.Empty(stderr);
        Assert.Single(output.Root!.Elements("Gericht"));
    }
}
