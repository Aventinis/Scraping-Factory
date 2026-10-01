using System.Diagnostics;
using System.Net;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #214: the Browser-engine counterpart to FlatModeDownloadEndToEndTests
// — proves flat mode's own _download_resource works via page.context.request
// the same way the pre-existing container-mode one does (see
// PlaywrightDownloadResourceEndToEndTests). Real subprocess run against a
// real local HTTP server, same reasoning as every other *EndToEndTests class.
public class PlaywrightFlatModeDownloadEndToEndTests
{
    private static async Task<(int ExitCode, string Stderr, string WorkDir)> GenerateAndRunAsync(ScrapingPlan plan, string tempPrefix)
    {
        var script = new PythonPlaywrightCodeGenerator().Generate(plan);
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
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
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

    private static ScrapingPlan BuildPlan(
        string startUrl, bool download, int? maxDownloadSizeBytes = null, List<string>? allowedContentTypes = null) => new()
    {
        Engine = ScrapingEngine.Browser,
        Steps =
        [
            new NavigateStep { Urls = [startUrl] },
            new ExtractStep
            {
                Name = "FileLink", Selector = "a.file", Attribute = "href", Download = download,
                MaxDownloadSizeBytes = maxDownloadSizeBytes, AllowedContentTypes = allowedContentTypes,
            },
        ],
    };

    private static string ExtractCsvValue(string csv, string columnName)
    {
        var lines = csv.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var header = lines[0].Split(',');
        var columnIndex = Array.IndexOf(header, columnName);
        Assert.True(columnIndex >= 0, $"Expected a '{columnName}' column in:\n{csv}");
        var row = lines[1].Split(',');
        var value = row.Length > columnIndex ? row[columnIndex] : "";
        return value is "\"\"" ? "" : value;
    }

    [Fact]
    public async Task AttributeFieldWithDownload_SavesLocalFileAndWritesItsOwnPathInstead()
    {
        const string fileBytes = "FAKE_PDF_BYTES_NOT_A_REAL_PDF";
        using var server = new LocalTestServer(request =>
            request.Url!.AbsolutePath == "/report.pdf"
                ? new LocalTestServerResponse(fileBytes, "application/pdf")
                : new LocalTestServerResponse(
                    "<html><body><a class='file' href='/report.pdf'>Report</a></body></html>",
                    "text/html; charset=utf-8"));
        var plan = BuildPlan(server.BaseUrl, download: true);

        var (exit, stderr, workDir) = await GenerateAndRunAsync(plan, "scrapingfactory-pw-flat-download-test-");
        try
        {
            Assert.Equal(0, exit);
            Assert.Empty(stderr);

            var outputCsv = await File.ReadAllTextAsync(Path.Combine(workDir, "output.csv"));
            var localPath = ExtractCsvValue(outputCsv, "FileLink");
            Assert.DoesNotContain("http://", localPath);
            Assert.EndsWith(".pdf", localPath);

            var fullLocalPath = Path.Combine(workDir, localPath);
            Assert.True(File.Exists(fullLocalPath), $"Expected downloaded file at {fullLocalPath}");
            Assert.Equal(fileBytes, await File.ReadAllTextAsync(fullLocalPath));
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task FailedDownload_LeavesFieldEmptyAndPrintsWarningButDoesNotFailTheRun()
    {
        using var server = new LocalTestServer(request =>
            request.Url!.AbsolutePath == "/missing.pdf"
                ? new LocalTestServerResponse("not found", "text/plain", HttpStatusCode.NotFound)
                : new LocalTestServerResponse(
                    "<html><body><a class='file' href='/missing.pdf'>Report</a></body></html>",
                    "text/html; charset=utf-8"));
        var plan = BuildPlan(server.BaseUrl, download: true);

        var (exit, stderr, workDir) = await GenerateAndRunAsync(plan, "scrapingfactory-pw-flat-download-test-");
        try
        {
            Assert.Equal(0, exit);
            Assert.Contains("WARNING", stderr);

            var outputCsv = await File.ReadAllTextAsync(Path.Combine(workDir, "output.csv"));
            Assert.Equal("", ExtractCsvValue(outputCsv, "FileLink"));
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task DownloadWithDisallowedContentType_LeavesFieldEmptyAndPrintsWarningButDoesNotFailTheRun()
    {
        const string fileBytes = "FAKE_PDF_BYTES_NOT_A_REAL_PDF";
        using var server = new LocalTestServer(request =>
            request.Url!.AbsolutePath == "/report.pdf"
                ? new LocalTestServerResponse(fileBytes, "application/pdf")
                : new LocalTestServerResponse(
                    "<html><body><a class='file' href='/report.pdf'>Report</a></body></html>",
                    "text/html; charset=utf-8"));
        var plan = BuildPlan(server.BaseUrl, download: true, allowedContentTypes: ["application/zip"]);

        var (exit, stderr, workDir) = await GenerateAndRunAsync(plan, "scrapingfactory-pw-flat-download-test-");
        try
        {
            Assert.Equal(0, exit);
            Assert.Contains("WARNING", stderr);
            Assert.Contains("content type", stderr);

            var outputCsv = await File.ReadAllTextAsync(Path.Combine(workDir, "output.csv"));
            Assert.Equal("", ExtractCsvValue(outputCsv, "FileLink"));
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }
}
