using System.Diagnostics;
using System.Net;
using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #213: real end-to-end proof that an Attribute-mode field with
// Download enabled actually downloads the resource and writes its own local
// file path into the output instead of the bare URL — a black-box "did
// /generate succeed" check can't distinguish "wrote the URL" from "wrote a
// local path", so this runs the generated script as a real subprocess
// against a real local HTTP server (LocalTestServer) and inspects both the
// output file and the downloaded file on disk. Static engine only, same
// scope as this issue's own first version (container mode, Attribute mode).
public class DownloadResourceEndToEndTests
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

    private static ScrapingPlan BuildPlan(string startUrl, bool download) => new()
    {
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

    private static LocalTestServer CreateFixtureServer(string imageBytes) => new(request =>
        request.Url!.AbsolutePath == "/image.jpg"
            ? new LocalTestServerResponse(imageBytes, "image/jpeg")
            : new LocalTestServerResponse(
                "<html><body><div class='item'><img class='photo' src='/image.jpg' /></div></body></html>",
                "text/html; charset=utf-8"));

    [Fact]
    public async Task AttributeFieldWithDownload_SavesLocalFileAndWritesItsOwnPathInstead()
    {
        const string imageBytes = "FAKE_IMAGE_BYTES_NOT_A_REAL_JPEG";
        using var server = CreateFixtureServer(imageBytes);
        var plan = BuildPlan(server.BaseUrl, download: true);

        var (exit, stderr, workDir) = await GenerateAndRunAsync(plan, "scrapingfactory-download-test-");
        try
        {
            Assert.Equal(0, exit);
            Assert.Empty(stderr);

            var outputXml = await File.ReadAllTextAsync(Path.Combine(workDir, "output.xml"));
            var match = Regex.Match(outputXml, "<Photo>(.*?)</Photo>");
            Assert.True(match.Success, $"Expected a <Photo> element in:\n{outputXml}");

            var localPath = match.Groups[1].Value;
            Assert.DoesNotContain("http://", localPath); // not the bare URL
            Assert.EndsWith(".jpg", localPath); // preserved the URL's own extension

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
    public async Task AttributeFieldWithoutDownload_StillWritesTheBareUrl()
    {
        const string imageBytes = "FAKE_IMAGE_BYTES_NOT_A_REAL_JPEG";
        using var server = CreateFixtureServer(imageBytes);
        var plan = BuildPlan(server.BaseUrl, download: false);

        var (exit, stderr, workDir) = await GenerateAndRunAsync(plan, "scrapingfactory-download-test-");
        try
        {
            Assert.Equal(0, exit);
            Assert.Empty(stderr);

            var outputXml = await File.ReadAllTextAsync(Path.Combine(workDir, "output.xml"));
            Assert.Contains("<Photo>/image.jpg</Photo>", outputXml);
            Assert.False(Directory.Exists(Path.Combine(workDir, "output.xml.downloads")));
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task FailedDownload_LeavesFieldEmptyAndPrintsWarningButDoesNotFailTheRun()
    {
        // The main page loads fine (200) — only the image itself 404s.
        using var server = new LocalTestServer(request =>
            request.Url!.AbsolutePath == "/missing.jpg"
                ? new LocalTestServerResponse("not found", "text/plain", HttpStatusCode.NotFound)
                : new LocalTestServerResponse(
                    "<html><body><div class='item'><img class='photo' src='/missing.jpg' /></div></body></html>",
                    "text/html; charset=utf-8"));
        var plan = BuildPlan(server.BaseUrl, download: true);

        var (exit, stderr, workDir) = await GenerateAndRunAsync(plan, "scrapingfactory-download-test-");
        try
        {
            Assert.Equal(0, exit); // a broken resource must not fail the whole run
            Assert.Contains("WARNING", stderr);
            Assert.Contains("/missing.jpg", stderr);

            var outputXml = await File.ReadAllTextAsync(Path.Combine(workDir, "output.xml"));
            Assert.Contains("<Photo />", outputXml); // empty value, not the broken URL
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task RepeatedRun_ReusesTheAlreadyDownloadedFileInsteadOfRedownloading()
    {
        var requestCount = 0;
        const string imageBytes = "FAKE_IMAGE_BYTES_NOT_A_REAL_JPEG";
        using var server = new LocalTestServer(request =>
        {
            if (request.Url!.AbsolutePath == "/image.jpg")
            {
                requestCount++;
                return new LocalTestServerResponse(imageBytes, "image/jpeg");
            }
            return new LocalTestServerResponse(
                "<html><body><div class='item'><img class='photo' src='/image.jpg' /></div></body></html>",
                "text/html; charset=utf-8");
        });
        var plan = BuildPlan(server.BaseUrl, download: true);

        var script = new PythonCodeGenerator().Generate(plan);
        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-download-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);

            async Task<int> RunOnceAsync()
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "python3", WorkingDirectory = workDir,
                    RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false,
                };
                psi.ArgumentList.Add(scriptPath);
                using var process = new Process { StartInfo = psi };
                process.Start();
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                await process.WaitForExitAsync(cts.Token);
                return process.ExitCode;
            }

            Assert.Equal(0, await RunOnceAsync());
            Assert.Equal(1, requestCount);

            Assert.Equal(0, await RunOnceAsync());
            Assert.Equal(1, requestCount); // second run found the file already on disk — no second fetch
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }
}
