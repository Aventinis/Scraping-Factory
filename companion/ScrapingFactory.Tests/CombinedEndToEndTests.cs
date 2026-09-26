using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #239: Combined mode — a list of fully independent component configs
// merged into one script. Mutual-exclusion/structural checks are covered
// against the real /generate endpoint (WebApplicationFactory, same pattern
// CompanionEndpointTests already uses); the stable-per-component-directory
// decision — the one genuinely new architectural risk in this feature — can
// only be proven with a real, two-run subprocess test, the same reasoning
// HardeningBaselineEndToEndTests/PersistentSessionEndToEndTests already
// established for their own sidecar-persistence claims.
public class CombinedEndToEndTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    private static StringContent JsonBody(object value) =>
        new(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json");

    private static ScrapingConfig SimpleFieldsConfig(string baseUrl, string fieldName = "Titel", string selector = "h1") => new()
    {
        Url = baseUrl,
        Fields = [new ScrapingField { Name = fieldName, Selector = selector }],
    };

    [Fact]
    public async Task Generate_CombinedWithFieldsAlsoSet_Returns400()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
            Combined =
            [
                new CombinedComponentConfig { Name = "a", Config = SimpleFieldsConfig(server.BaseUrl) },
                new CombinedComponentConfig { Name = "b", Config = SimpleFieldsConfig(server.BaseUrl) },
            ],
        };

        var response = await _client.PostAsync("/generate", JsonBody(config));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("mutually exclusive", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Generate_CombinedWithOnlyOneComponent_Returns400()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Combined = [new CombinedComponentConfig { Name = "a", Config = SimpleFieldsConfig(server.BaseUrl) }],
        };

        var response = await _client.PostAsync("/generate", JsonBody(config));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("at least 2", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Generate_CombinedWithNestedCombined_Returns400()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var nested = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Combined =
            [
                new CombinedComponentConfig { Name = "x", Config = SimpleFieldsConfig(server.BaseUrl) },
                new CombinedComponentConfig { Name = "y", Config = SimpleFieldsConfig(server.BaseUrl) },
            ],
        };
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Combined =
            [
                new CombinedComponentConfig { Name = "a", Config = nested },
                new CombinedComponentConfig { Name = "b", Config = SimpleFieldsConfig(server.BaseUrl) },
            ],
        };

        var response = await _client.PostAsync("/generate", JsonBody(config));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Nested Combined", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Generate_CombinedWithDuplicateComponentNames_Returns400()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Combined =
            [
                new CombinedComponentConfig { Name = "products", Config = SimpleFieldsConfig(server.BaseUrl) },
                new CombinedComponentConfig { Name = "products", Config = SimpleFieldsConfig(server.BaseUrl) },
            ],
        };

        var response = await _client.PostAsync("/generate", JsonBody(config));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Duplicate component names", await response.Content.ReadAsStringAsync());
    }

    // Representative of the eight outer-level cross-cutting field rejections
    // in Program.cs (AdditionalUrls/Pagination/BrowserActions/
    // ChangeDetection/Proxy/Hardening/PersistentSession/ExternalConfig) —
    // all component-level-only for v1, all sharing the exact same shape of
    // check, so only two are exercised end-to-end here rather than all eight.
    [Fact]
    public async Task Generate_CombinedWithOuterAdditionalUrls_Returns400()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            AdditionalUrls = [server.BaseUrl],
            Combined =
            [
                new CombinedComponentConfig { Name = "a", Config = SimpleFieldsConfig(server.BaseUrl) },
                new CombinedComponentConfig { Name = "b", Config = SimpleFieldsConfig(server.BaseUrl) },
            ],
        };

        var response = await _client.PostAsync("/generate", JsonBody(config));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("AdditionalUrls", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Generate_CombinedWithOuterProxy_Returns400()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Proxy = new ProxyConfig { EnvironmentVariableName = "SF_TEST_PROXY" },
            Combined =
            [
                new CombinedComponentConfig { Name = "a", Config = SimpleFieldsConfig(server.BaseUrl) },
                new CombinedComponentConfig { Name = "b", Config = SimpleFieldsConfig(server.BaseUrl) },
            ],
        };

        var response = await _client.PostAsync("/generate", JsonBody(config));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Proxy", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Generate_CombinedHappyPath_MergesComponentsIntoOneJsonObjectKeyedByName()
    {
        using var serverA = new LocalTestServer("<html><body><h1 class='item'>Suppe</h1></body></html>");
        using var serverB = new LocalTestServer("<html><body><h1 class='item'>Salat</h1></body></html>");
        var config = new ScrapingConfig
        {
            Url = serverA.BaseUrl,
            Combined =
            [
                new CombinedComponentConfig { Name = "menuA", Config = SimpleFieldsConfig(serverA.BaseUrl, "Gericht", "h1.item") },
                new CombinedComponentConfig { Name = "menuB", Config = SimpleFieldsConfig(serverB.BaseUrl, "Gericht", "h1.item") },
            ],
        };

        var response = await _client.PostAsync("/generate", JsonBody(config));
        var body = await response.Content.ReadAsStringAsync();

        Assert.True(HttpStatusCode.OK == response.StatusCode, body);
        Assert.Contains("import base64", body);

        // Plain-text script response (no IncludePreview/IncludeOutputFile) —
        // request the merged output separately to inspect its shape.
        var previewConfig = new ScrapingConfig { Url = config.Url, Combined = config.Combined, IncludeOutputFile = true };
        var previewResponse = await _client.PostAsync("/generate", JsonBody(previewConfig));
        var previewBody = await previewResponse.Content.ReadFromJsonAsync<JsonElement>();
        var outputContent = previewBody.GetProperty("outputFile").GetProperty("content").GetString()!;
        var merged = JsonDocument.Parse(outputContent).RootElement;

        Assert.Equal("Suppe", merged.GetProperty("menuA")[0].GetProperty("Gericht").GetString());
        Assert.Equal("Salat", merged.GetProperty("menuB")[0].GetProperty("Gericht").GetString());
    }

    [Fact]
    public async Task Generate_CombinedWithFailingComponent_ReturnsUnprocessableEntityNamingComponent()
    {
        using var server = new LocalTestServer("<html><body><h1 class='item'>Suppe</h1></body></html>");
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Combined =
            [
                new CombinedComponentConfig { Name = "good", Config = SimpleFieldsConfig(server.BaseUrl, "Gericht", "h1.item") },
                // .missing-selector never matches anything on this page — the
                // component's own trial run fails "no data", surfacing as a
                // named 422 for the whole Combined request.
                new CombinedComponentConfig { Name = "bad", Config = SimpleFieldsConfig(server.BaseUrl, "Gericht", ".missing-selector") },
            ],
        };

        var response = await _client.PostAsync("/generate", JsonBody(config));
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        Assert.Contains("'bad'", body);
    }

    [Fact]
    public async Task Generate_CombinedComponentExitsWithMissingEnvVar_StillMergesSuccessfully()
    {
        using var server = new LocalTestServer("<html><body><h1 class='item'>Suppe</h1></body></html>");
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Combined =
            [
                new CombinedComponentConfig { Name = "good", Config = SimpleFieldsConfig(server.BaseUrl, "Gericht", "h1.item") },
                new CombinedComponentConfig
                {
                    Name = "proxied",
                    // No VerificationValues/real env var is ever set for
                    // SF_TEST_COMBINED_PROXY_UNSET — the component itself is
                    // expected to exit 78 (EXIT_MISSING_ENV_VAR), which the
                    // combined script's own COMPATIBLE_EXIT_CODES must still
                    // accept.
                    Config = new ScrapingConfig
                    {
                        Url = server.BaseUrl,
                        Fields = [new ScrapingField { Name = "Gericht", Selector = "h1.item" }],
                        Proxy = new ProxyConfig { EnvironmentVariableName = "SF_TEST_COMBINED_PROXY_UNSET" },
                    },
                },
            ],
        };

        var response = await _client.PostAsync("/generate", JsonBody(config));
        var body = await response.Content.ReadAsStringAsync();

        Assert.True(HttpStatusCode.OK == response.StatusCode, body);
    }
}

// The stable-per-component-directory decision (chosen over disposable temp
// directories specifically so sidecar state persists across separate runs
// of the combined script) can only be proven by actually running the same
// combined script twice and inspecting a component's own sidecar file in
// between — the same reasoning HardeningBaselineEndToEndTests already
// established for the identical BaselineCheck mechanism running standalone.
// Built directly against the codegen classes (not /generate) since
// PythonScriptVerifier's own trial run always uses a fresh temp directory,
// so it could never exercise a second run of the same script the way this
// test needs to.
public class CombinedSidecarPersistenceTests
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

    private static string BuildPageWithItems(int count)
    {
        var items = string.Join("", Enumerable.Range(1, count).Select(i => $"<h1 class='item'>Item {i}</h1>"));
        return $"<html><body>{items}</body></html>";
    }

    private static int? ReadBaselineCount(string baselinePath)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(baselinePath));
        return doc.RootElement.GetProperty("count").GetInt32();
    }

    [Fact]
    public async Task SecondRun_ComponentWithBaselineCheck_SidecarPersistsInStableComponentDirectory()
    {
        using var serverWithBaseline = new LocalTestServer(BuildPageWithItems(10));
        using var plainServer = new LocalTestServer("<html><body><h1 class='item'>Static</h1></body></html>");

        var planWithBaseline = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [serverWithBaseline.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = ".item" }],
            Hardening = [new BaselineCheck { Severity = HardeningSeverity.Warning, DropThreshold = 0.9 }],
            OutputFormat = OutputFormat.Json,
            OutputFileBaseName = "output",
        };
        var scriptWithBaseline = new PythonCodeGenerator().Generate(planWithBaseline);

        var plainPlan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [plainServer.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = ".item" }],
            OutputFormat = OutputFormat.Json,
            OutputFileBaseName = "output",
        };
        var plainScript = new PythonCodeGenerator().Generate(plainPlan);

        var combinedScript = PythonCombinedScriptGenerator.Generate(
            [("with_baseline", scriptWithBaseline), ("plain", plainScript)], "combined", "output");

        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-combined-test-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "combined.py");
            await File.WriteAllTextAsync(scriptPath, combinedScript);

            var (firstExit, firstStderr) = await RunScriptAsync(scriptPath, workDir);
            Assert.True(firstExit == 0, firstStderr);

            var baselinePath = Path.Combine(workDir, "output_components", "with_baseline", "output.json.hardening-baseline.json");
            Assert.True(File.Exists(baselinePath));
            Assert.Equal(10, ReadBaselineCount(baselinePath));

            // Second run of the SAME combined script, same working
            // directory — only the component's own stable subdirectory
            // (not a disposable temp dir) makes this sidecar file findable
            // again on this second, separate run.
            var (secondExit, secondStderr) = await RunScriptAsync(scriptPath, workDir);
            Assert.True(secondExit == 0, secondStderr);
            Assert.Equal(10, ReadBaselineCount(baselinePath));

            var mergedPath = Path.Combine(workDir, "output.json");
            Assert.True(File.Exists(mergedPath));
            var merged = JsonDocument.Parse(await File.ReadAllTextAsync(mergedPath)).RootElement;
            Assert.Equal(10, merged.GetProperty("with_baseline").GetArrayLength());
            Assert.Equal(1, merged.GetProperty("plain").GetArrayLength());
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }
}
