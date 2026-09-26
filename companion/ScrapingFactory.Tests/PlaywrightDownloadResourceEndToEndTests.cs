using System.Diagnostics;
using System.Net;
using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #213: the Browser-engine counterpart to DownloadResourceEndToEndTests
// — proves _download_resource actually works via page.context.request
// (Playwright's own APIRequestContext) rather than a bare `requests` import,
// which this engine doesn't have. Real subprocess run against a real local
// HTTP server, same reasoning as every other *EndToEndTests class in this
// project: a black-box "did /generate succeed" check can't tell "wrote the
// URL" apart from "wrote a local path".
public class PlaywrightDownloadResourceEndToEndTests
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

    private static ScrapingPlan BuildPlan(string startUrl, bool download) => new()
    {
        Engine = ScrapingEngine.Browser,
        Steps =
        [
            new NavigateStep { Urls = [startUrl] },
            new ExtractGroupStep
            {
                Roots =
                [
                    new GroupNode
                    {
                        Name = "Item", Selector = ".item", Repeating = true,
                        Children =
                        [
                            new DataFieldNode { Name = "Photo", Selector = ".photo", Mode = ExtractMode.Attribute, Attribute = "src", Download = download },
                        ],
                    },
                ],
            },
        ],
    };

    [Fact]
    public async Task AttributeFieldWithDownload_SavesLocalFileAndWritesItsOwnPathInstead()
    {
        const string imageBytes = "FAKE_IMAGE_BYTES_NOT_A_REAL_JPEG";
        using var server = new LocalTestServer(request =>
            request.Url!.AbsolutePath == "/image.jpg"
                ? new LocalTestServerResponse(imageBytes, "image/jpeg")
                : new LocalTestServerResponse(
                    "<html><body><div class='item'><img class='photo' src='/image.jpg' /></div></body></html>",
                    "text/html; charset=utf-8"));
        var plan = BuildPlan(server.BaseUrl, download: true);

        var (exit, stderr, workDir) = await GenerateAndRunAsync(plan, "scrapingfactory-pw-download-test-");
        try
        {
            Assert.Equal(0, exit);
            Assert.Empty(stderr);

            var outputXml = await File.ReadAllTextAsync(Path.Combine(workDir, "output.xml"));
            var match = Regex.Match(outputXml, "<Photo>(.*?)</Photo>");
            Assert.True(match.Success, $"Expected a <Photo> element in:\n{outputXml}");

            var localPath = match.Groups[1].Value;
            Assert.DoesNotContain("http://", localPath);
            Assert.EndsWith(".jpg", localPath);

            var fullLocalPath = Path.Combine(workDir, localPath);
            Assert.True(File.Exists(fullLocalPath), $"Expected downloaded file at {fullLocalPath}");
            Assert.Equal(imageBytes, await File.ReadAllTextAsync(fullLocalPath));
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
            request.Url!.AbsolutePath == "/missing.jpg"
                ? new LocalTestServerResponse("not found", "text/plain", HttpStatusCode.NotFound)
                : new LocalTestServerResponse(
                    "<html><body><div class='item'><img class='photo' src='/missing.jpg' /></div></body></html>",
                    "text/html; charset=utf-8"));
        var plan = BuildPlan(server.BaseUrl, download: true);

        var (exit, stderr, workDir) = await GenerateAndRunAsync(plan, "scrapingfactory-pw-download-test-");
        try
        {
            Assert.Equal(0, exit);
            Assert.Contains("WARNING", stderr);

            var outputXml = await File.ReadAllTextAsync(Path.Combine(workDir, "output.xml"));
            Assert.Contains("<Photo />", outputXml);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }
}
