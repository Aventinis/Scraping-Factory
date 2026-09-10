using System.Diagnostics;
using System.Net;
using System.Text;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #87: real end-to-end proof that a generated script actually detects
// a change between two runs and notifies — the same "prove the exact
// artifact works" philosophy as PythonScriptVerifierTests, but these tests
// deliberately don't go through PythonScriptVerifier itself: VerifyAsync
// always runs in a fresh temp directory (the whole point of trial-run
// isolation), so there's never a "previous run's output" for a second call
// to find. Change detection only ever matters across multiple runs of the
// *same downloaded script* in the *same* working directory (e.g. a user's
// own cron job) — so these tests run the real generated script as a raw
// subprocess, twice, in one shared directory they control themselves.
public class ChangeDetectionEndToEndTests
{
    private static async Task<(int ExitCode, string Stderr)> RunScriptAsync(
        string scriptPath, string workDir, IReadOnlyDictionary<string, string> env)
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
            foreach (var (key, value) in env)
                psi.Environment[key] = value;

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

    [Fact]
    public async Task Webhook_NotifiesOnlyOnceContentActuallyChangesAcrossRuns()
    {
        var currentHtml = "<html><body><h1>V1</h1></body></html>";
        using var pageServer = new LocalTestServer(_ =>
            new LocalTestServerResponse(currentHtml, "text/html; charset=utf-8"));

        var receivedPayloads = new List<string>();
        using var webhookServer = new LocalTestServer(request =>
        {
            using var reader = new StreamReader(request.InputStream, Encoding.UTF8);
            lock (receivedPayloads) receivedPayloads.Add(reader.ReadToEnd());
            return new LocalTestServerResponse("ok", "text/plain");
        });

        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [pageServer.BaseUrl] },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
            ChangeDetection = new ChangeDetectionConfig
            {
                Notify = "Webhook",
                Webhook = new WebhookNotificationConfig { UrlEnvVar = "SF_TEST_WEBHOOK_URL" },
            },
        };
        var script = new PythonCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-cd-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            var env = new Dictionary<string, string> { ["SF_TEST_WEBHOOK_URL"] = webhookServer.BaseUrl };

            // Run 1: no previous output.csv yet — establishes the baseline,
            // no notification attempted at all.
            var (exit1, stderr1) = await RunScriptAsync(scriptPath, workDir, env);
            Assert.Equal(0, exit1);
            Assert.Empty(stderr1);
            Assert.Empty(receivedPayloads);

            // Run 2: page content unchanged — still no notification.
            var (exit2, _) = await RunScriptAsync(scriptPath, workDir, env);
            Assert.Equal(0, exit2);
            Assert.Empty(receivedPayloads);

            // Run 3: page content genuinely changes — notification fires.
            currentHtml = "<html><body><h1>V2</h1></body></html>";
            var (exit3, _) = await RunScriptAsync(scriptPath, workDir, env);
            Assert.Equal(0, exit3);
            var payload = Assert.Single(receivedPayloads);
            Assert.Contains("V1", payload);
            Assert.Contains("V2", payload);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    [Fact]
    public async Task Email_NotifiesWithUnifiedDiffWhenContentChanges()
    {
        var currentHtml = "<html><body><h1>V1</h1></body></html>";
        using var pageServer = new LocalTestServer(_ =>
            new LocalTestServerResponse(currentHtml, "text/html; charset=utf-8"));
        using var smtpServer = new LocalSmtpTestServer();

        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [pageServer.BaseUrl] },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
            ChangeDetection = new ChangeDetectionConfig
            {
                Notify = "Email",
                Email = new EmailNotificationConfig
                {
                    SmtpHostEnvVar = "SF_TEST_SMTP_HOST",
                    SmtpPortEnvVar = "SF_TEST_SMTP_PORT",
                    FromEnvVar = "SF_TEST_FROM",
                    ToEnvVar = "SF_TEST_TO",
                },
            },
        };
        var script = new PythonCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-cd-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            var env = new Dictionary<string, string>
            {
                ["SF_TEST_SMTP_HOST"] = smtpServer.Host,
                ["SF_TEST_SMTP_PORT"] = smtpServer.Port.ToString(),
                ["SF_TEST_FROM"] = "scraper@example.com",
                ["SF_TEST_TO"] = "watcher@example.com",
            };

            var (exit1, stderr1) = await RunScriptAsync(scriptPath, workDir, env);
            Assert.Equal(0, exit1);
            Assert.Empty(stderr1);
            Assert.Empty(smtpServer.ReceivedMessages);

            currentHtml = "<html><body><h1>V2</h1></body></html>";
            var (exit2, stderr2) = await RunScriptAsync(scriptPath, workDir, env);
            Assert.Equal(0, exit2);
            Assert.Empty(stderr2);
            var message = Assert.Single(smtpServer.ReceivedMessages);
            Assert.Contains("scraper@example.com", message);
            Assert.Contains("watcher@example.com", message);
            Assert.Contains("V1", message);
            Assert.Contains("V2", message);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }

    // The current run's own output has already been written successfully by
    // the time a notification is even attempted — an unreachable webhook
    // must not turn a genuinely successful scrape into a failed run.
    [Fact]
    public async Task NotificationFailure_IsWarningOnly_DoesNotFailTheRun()
    {
        var currentHtml = "<html><body><h1>V1</h1></body></html>";
        using var pageServer = new LocalTestServer(_ =>
            new LocalTestServerResponse(currentHtml, "text/html; charset=utf-8"));

        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [pageServer.BaseUrl] },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
            ChangeDetection = new ChangeDetectionConfig
            {
                Notify = "Webhook",
                Webhook = new WebhookNotificationConfig { UrlEnvVar = "SF_TEST_WEBHOOK_URL" },
            },
        };
        var script = new PythonCodeGenerator().Generate(plan);

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-cd-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            // Port 1 is a privileged, essentially-never-listening port — the
            // same trick PythonScriptVerifierTests already uses to simulate
            // an unreachable target.
            var env = new Dictionary<string, string> { ["SF_TEST_WEBHOOK_URL"] = "http://127.0.0.1:1/nope" };

            var (exit1, _) = await RunScriptAsync(scriptPath, workDir, env);
            Assert.Equal(0, exit1);

            currentHtml = "<html><body><h1>V2</h1></body></html>";
            var (exit2, stderr2) = await RunScriptAsync(scriptPath, workDir, env);
            Assert.Equal(0, exit2);
            Assert.Empty(stderr2);

            var outputPath = Path.Combine(workDir, "output.csv");
            var lines = await File.ReadAllLinesAsync(outputPath);
            Assert.Equal(2, lines.Length); // header + one data row
            Assert.Contains("V2", lines[1]);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }
}
