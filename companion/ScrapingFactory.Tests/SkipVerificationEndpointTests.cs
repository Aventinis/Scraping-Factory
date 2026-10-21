using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #292: skipVerification returns the generated script without ever
// running it. Every request below points at a host that doesn't exist, so a
// real trial run would fail with a 422 — a 200 therefore proves no
// subprocess was started — while the structural validation (400) still runs.
public class SkipVerificationEndpointTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private const string Header = "X-ScrapingFactory-Verification-Skipped";
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<(HttpResponseMessage Response, string Body)> PostAsync(string payload)
    {
        var stopwatch = Stopwatch.StartNew();
        var response = await _client.PostAsync("/generate", new StringContent(payload, Encoding.UTF8, "application/json"));
        stopwatch.Stop();
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(20), $"Expected an immediate answer, took {stopwatch.Elapsed}.");
        return (response, await response.Content.ReadAsStringAsync());
    }

    private static string Flat(string extra = "", string url = "https://example.invalid/") => $$"""
        { "url": "{{url}}", "fields": [ { "name": "Titel", "selector": "h1" } ] {{extra}} }
        """;

    [Fact]
    public async Task WithoutTheFlag_AnUnreachableSiteStillFailsTheTrialRun()
    {
        var (response, _) = await PostAsync(Flat());
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task SingleMode_ReturnsTheScriptAndTheSettingsReason()
    {
        var (response, body) = await PostAsync(Flat(", \"skipVerification\": true"));

        Assert.True(HttpStatusCode.OK == response.StatusCode, body);
        Assert.Contains("def scrape", body);
        Assert.True(response.Headers.TryGetValues(Header, out var reasons), body);
        Assert.Contains("disabled in Settings", reasons!.Single());
        AssertAscii(reasons!.Single());
    }

    // Kestrel refuses a response header with non-ASCII characters (a 500),
    // which the in-memory test server doesn't notice — so check the text.
    private static void AssertAscii(string headerValue) =>
        Assert.True(headerValue.All(c => c is >= ' ' and <= '~'), $"Header value must be plain ASCII: {headerValue}");

    [Fact]
    public async Task TimeoutCapReason_IsAlsoAHeaderSafeText()
    {
        var (response, body) = await PostAsync("""
            {
              "url": "https://example.invalid/",
              "engine": "Browser",
              "fields": [ { "name": "Titel", "selector": "h1" } ],
              "browserActions": [ { "kind": "scroll", "maxIterations": 10000, "waitAfterMs": 1000 } ]
            }
            """);

        Assert.True(HttpStatusCode.OK == response.StatusCode, body);
        AssertAscii(response.Headers.GetValues(Header).Single());
    }

    [Fact]
    public async Task SkipVerificationFalse_BehavesLikeAbsent()
    {
        var (response, _) = await PostAsync(Flat(", \"skipVerification\": false"));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // A requested preview/output file has nothing to be read from — the
    // envelope keeps its shape with null members, like the timeout-cap skip.
    [Fact]
    public async Task SingleMode_WithPreviewAndOutputFile_KeepsTheEnvelopeWithNulls()
    {
        var (response, body) = await PostAsync(Flat(", \"skipVerification\": true, \"includePreview\": true, \"includeOutputFile\": true"));

        Assert.True(HttpStatusCode.OK == response.StatusCode, body);
        using var json = JsonDocument.Parse(body);
        Assert.Contains("def scrape", json.RootElement.GetProperty("script").GetString());
        Assert.Equal(JsonValueKind.Null, json.RootElement.GetProperty("preview").ValueKind);
        Assert.Equal(JsonValueKind.Null, json.RootElement.GetProperty("outputFile").ValueKind);
    }

    [Fact]
    public async Task StructuralValidationStillRuns()
    {
        var (response, body) = await PostAsync(Flat(", \"skipVerification\": true", url: "not-a-url"));

        Assert.True(HttpStatusCode.BadRequest == response.StatusCode, body);
        Assert.False(response.Headers.Contains(Header));
    }

    [Fact]
    public async Task BrowserEngine_ReturnsThePlaywrightScript()
    {
        var (response, body) = await PostAsync(Flat(", \"engine\": \"Browser\", \"skipVerification\": true"));

        Assert.True(HttpStatusCode.OK == response.StatusCode, body);
        Assert.Contains("sync_playwright", body);
    }

    [Fact]
    public async Task ApiMode_ReturnsTheScript()
    {
        var (response, body) = await PostAsync("""
            {
              "url": "https://example.invalid/",
              "skipVerification": true,
              "api": {
                "urlTemplate": "https://example.invalid/api?n={n}",
                "itemsPath": "items",
                "fields": [ { "name": "Titel", "path": "title" } ],
                "parameters": [ { "name": "n", "source": { "kind": "staticList", "values": ["1"] } } ]
              }
            }
            """);

        Assert.True(HttpStatusCode.OK == response.StatusCode, body);
        Assert.True(response.Headers.Contains(Header), body);
    }

    [Fact]
    public async Task BlocksMode_ReturnsTheBlocksEnvelopeWithoutRunningAnything()
    {
        var (response, body) = await PostAsync("""
            {
              "url": "https://example.invalid/",
              "skipVerification": true,
              "includePreview": true,
              "blocks": [
                { "name": "block1", "fields": [ { "name": "Titel", "selector": "h1" } ] },
                { "name": "block2", "fields": [ { "name": "Titel", "selector": "h1" } ] }
              ]
            }
            """);

        Assert.True(HttpStatusCode.OK == response.StatusCode, body);
        Assert.True(response.Headers.Contains(Header), body);
        using var json = JsonDocument.Parse(body);
        var blocks = json.RootElement.GetProperty("blocks").EnumerateArray().ToList();
        Assert.Equal(2, blocks.Count);
        Assert.Equal(JsonValueKind.Null, blocks[0].GetProperty("preview").ValueKind);
    }

    [Fact]
    public async Task CombinedMode_ReturnsTheCombinedScript()
    {
        var (response, body) = await PostAsync("""
            {
              "url": "https://example.invalid/",
              "skipVerification": true,
              "combined": [
                { "name": "a", "config": { "url": "https://a.example.invalid/", "fields": [ { "name": "T", "selector": "h1" } ] } },
                { "name": "b", "config": { "url": "https://b.example.invalid/", "fields": [ { "name": "T", "selector": "h1" } ] } }
              ]
            }
            """);

        Assert.True(HttpStatusCode.OK == response.StatusCode, body);
        Assert.True(response.Headers.Contains(Header), body);
        Assert.Contains("COMPONENTS", body);
    }
}
