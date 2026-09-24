using System.Diagnostics;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #205: real end-to-end proof that the three explicit type-conversion
// transforms (ToIntegerTransform/ToBooleanTransform/ToDateTransform) produce
// the documented values at runtime, including their onError contract — the
// same "run the generated script for real, inspect output.csv" approach
// HardeningNullRateEndToEndTests already uses, since a field-level
// transformation result isn't observable any other way (PythonScriptVerifier
// only checks row/element counts, not individual cell values).
public class TypeConversionTransformEndToEndTests
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

    // Scrapes a single ".value" field off a one-element page and returns its
    // extracted, transformed cell (the second CSV line — the first is the
    // header) — enough to observe a single transform's actual runtime
    // result without needing to parse a whole CSV document per test.
    private static async Task<string> ScrapeSingleValueAsync(string rawValue, params FieldTransform[] transforms)
    {
        using var server = new LocalTestServer($"<html><body><span class='value'>{rawValue}</span></body></html>");
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractStep { Name = "Wert", Selector = ".value", Transforms = [.. transforms] },
            ],
        };
        var script = new PythonCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-typeconversion-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);

            var (exit, stderr) = await RunScriptAsync(scriptPath, workDir);
            Assert.Equal(0, exit);
            Assert.Empty(stderr);

            var lines = await File.ReadAllLinesAsync(Path.Combine(workDir, "output.csv"));
            Assert.Equal(2, lines.Length); // header + one data row
            return lines[1];
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task ToInteger_WellFormedValue_ConvertsCleanly()
    {
        var row = await ScrapeSingleValueAsync(" 42 ", new ToIntegerTransform());
        Assert.Equal("42", row);
    }

    [Fact]
    public async Task ToInteger_DecimalValue_KeepsOriginalOnFailure()
    {
        var row = await ScrapeSingleValueAsync("12.5", new ToIntegerTransform { OnError = TransformErrorMode.KeepOriginal });
        Assert.Equal("12.5", row);
    }

    [Fact]
    public async Task ToInteger_NonNumericValue_UsesConfiguredDefault()
    {
        var row = await ScrapeSingleValueAsync("n/a", new ToIntegerTransform { OnError = TransformErrorMode.UseDefault, DefaultValue = "0" });
        Assert.Equal("0", row);
    }

    [Theory]
    [InlineData("Yes", "True")]
    [InlineData("0", "False")]
    public async Task ToBoolean_RecognizedVocabulary_ConvertsToPythonBoolLiteralString(string raw, string expected)
    {
        var row = await ScrapeSingleValueAsync(raw, new ToBooleanTransform());
        Assert.Equal(expected, row);
    }

    [Fact]
    public async Task ToBoolean_UnrecognizedValue_UsesConfiguredDefault()
    {
        var row = await ScrapeSingleValueAsync("maybe", new ToBooleanTransform { OnError = TransformErrorMode.UseDefault, DefaultValue = "False" });
        Assert.Equal("False", row);
    }

    [Fact]
    public async Task ToDate_CustomSourceFormat_NormalizesToIso()
    {
        var row = await ScrapeSingleValueAsync("24.09.2026", new ToDateTransform { SourceFormat = "{dd}.{mm}.{yyyy}" });
        Assert.Equal("2026-09-24", row);
    }

    [Fact]
    public async Task ToDate_NonExistentCalendarDate_KeepsOriginalOnFailure()
    {
        // Structurally matches "{yyyy}-{mm}-{dd}" (the default format) but
        // February never has 30 days — must be rejected, not silently
        // rounded/rolled over into March.
        var row = await ScrapeSingleValueAsync("2026-02-30", new ToDateTransform());
        Assert.Equal("2026-02-30", row);
    }

    [Fact]
    public async Task ToDate_UnparseableValue_UsesConfiguredDefault()
    {
        var row = await ScrapeSingleValueAsync("not a date", new ToDateTransform { OnError = TransformErrorMode.UseDefault, DefaultValue = "unknown" });
        Assert.Equal("unknown", row);
    }

    // Proves the chain composes with the pre-existing transform kinds: the
    // raw value is trimmed, its digits are pulled out via regex, then
    // strictly converted to an integer — each step feeding the next.
    [Fact]
    public async Task ChainedTrimRegexExtractToInteger_ProducesCleanInteger()
    {
        var row = await ScrapeSingleValueAsync(
            "  Menge: 7 Stück  ",
            new TrimTransform(),
            new RegexExtractTransform { Pattern = @"\d+" },
            new ToIntegerTransform());
        Assert.Equal("7", row);
    }
}
