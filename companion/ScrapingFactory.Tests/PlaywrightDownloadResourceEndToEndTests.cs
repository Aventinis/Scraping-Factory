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
        var (result, workDir) = await ScriptRunner.RunInTempDirAsync(new PythonPlaywrightCodeGenerator().Generate(plan), tempPrefix, TimeSpan.FromSeconds(60));
        return (result.ExitCode, result.Stderr, workDir);
    }

    private static ScrapingPlan BuildPlan(
        string startUrl, bool download, int? maxDownloadSizeBytes = null, List<string>? allowedContentTypes = null) =>
        DownloadPlans.Container(startUrl, download, maxDownloadSizeBytes, allowedContentTypes, engine: ScrapingEngine.Browser);

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

    [Fact]
    public async Task DownloadExceedingMaxSize_LeavesFieldEmptyAndPrintsWarningButDoesNotFailTheRun()
    {
        const string imageBytes = "FAKE_IMAGE_BYTES_LONGER_THAN_THE_CONFIGURED_LIMIT";
        using var server = new LocalTestServer(request =>
            request.Url!.AbsolutePath == "/image.jpg"
                ? new LocalTestServerResponse(imageBytes, "image/jpeg")
                : new LocalTestServerResponse(
                    "<html><body><div class='item'><img class='photo' src='/image.jpg' /></div></body></html>",
                    "text/html; charset=utf-8"));
        var plan = BuildPlan(server.BaseUrl, download: true, maxDownloadSizeBytes: 10);

        var (exit, stderr, workDir) = await GenerateAndRunAsync(plan, "scrapingfactory-pw-download-test-");
        try
        {
            Assert.Equal(0, exit);
            Assert.Contains("WARNING", stderr);
            Assert.Contains("exceeds", stderr);

            var outputXml = await File.ReadAllTextAsync(Path.Combine(workDir, "output.xml"));
            Assert.Contains("<Photo />", outputXml);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task DownloadWithDisallowedContentType_LeavesFieldEmptyAndPrintsWarningButDoesNotFailTheRun()
    {
        const string imageBytes = "FAKE_IMAGE_BYTES_NOT_A_REAL_JPEG";
        using var server = new LocalTestServer(request =>
            request.Url!.AbsolutePath == "/image.jpg"
                ? new LocalTestServerResponse(imageBytes, "image/jpeg")
                : new LocalTestServerResponse(
                    "<html><body><div class='item'><img class='photo' src='/image.jpg' /></div></body></html>",
                    "text/html; charset=utf-8"));
        var plan = BuildPlan(server.BaseUrl, download: true, allowedContentTypes: ["application/pdf"]);

        var (exit, stderr, workDir) = await GenerateAndRunAsync(plan, "scrapingfactory-pw-download-test-");
        try
        {
            Assert.Equal(0, exit);
            Assert.Contains("WARNING", stderr);
            Assert.Contains("content type", stderr);

            var outputXml = await File.ReadAllTextAsync(Path.Combine(workDir, "output.xml"));
            Assert.Contains("<Photo />", outputXml);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }
}
