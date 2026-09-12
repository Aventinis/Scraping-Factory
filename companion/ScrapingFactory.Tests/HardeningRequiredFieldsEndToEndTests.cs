using System.Diagnostics;
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
}
