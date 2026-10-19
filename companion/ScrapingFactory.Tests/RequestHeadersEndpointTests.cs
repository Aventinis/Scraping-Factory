using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #226 through the real /generate endpoint: wire-format binding of
// `headers`, the outer-request rejections, and the one-time test value for a
// header's environment variable making the trial run pass without the
// variable being set in the OS environment.
public class RequestHeadersEndpointTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    private static StringContent Json(string payload) => new(payload, Encoding.UTF8, "application/json");

    // Serves the real page only when the expected key arrived as a header,
    // and a 403 otherwise — so a passing trial run proves the header was sent.
    private static LocalTestServer KeyProtectedServer() => new(request =>
        request.Headers["X-Api-Key"] == "trial-key"
            ? new LocalTestServerResponse("<html><body><h1>Titel</h1></body></html>", "text/html")
            : new LocalTestServerResponse("denied", "text/plain", HttpStatusCode.Forbidden));

    [Fact]
    public async Task Generate_WithHeaderEnvVarAndVerificationValue_PassesTheTrialRun()
    {
        using var server = KeyProtectedServer();
        var payload = $$"""
            {
              "url": "{{server.BaseUrl}}",
              "fields": [ { "name": "Titel", "selector": "h1" } ],
              "headers": [ { "name": "X-Api-Key", "environmentVariableName": "SF_TEST_TRIAL_API_KEY" } ],
              "verificationValues": { "SF_TEST_TRIAL_API_KEY": "trial-key" }
            }
            """;

        var response = await _client.PostAsync("/generate", Json(payload));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var script = await response.Content.ReadAsStringAsync();
        Assert.Contains("SF_TEST_TRIAL_API_KEY", script);
        Assert.DoesNotContain("trial-key", script); // the test value never reaches the generated script
    }

    [Fact]
    public async Task Generate_WithHeaderEnvVarButNoVerificationValue_FailsWithTheCleanMissingVariableMessage()
    {
        using var server = KeyProtectedServer();
        var payload = $$"""
            {
              "url": "{{server.BaseUrl}}",
              "fields": [ { "name": "Titel", "selector": "h1" } ],
              "headers": [ { "name": "X-Api-Key", "environmentVariableName": "SF_TEST_UNSET_TRIAL_VAR" } ]
            }
            """;

        var response = await _client.PostAsync("/generate", Json(payload));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        var error = await response.Content.ReadAsStringAsync();
        Assert.Contains("SF_TEST_UNSET_TRIAL_VAR", error);
        Assert.DoesNotContain("Traceback", error);
    }

    [Fact]
    public async Task Generate_WithLiteralHeader_ReachesTheServer()
    {
        using var server = KeyProtectedServer();
        var payload = $$"""
            {
              "url": "{{server.BaseUrl}}",
              "fields": [ { "name": "Titel", "selector": "h1" } ],
              "headers": [ { "name": "X-Api-Key", "value": "trial-key" } ]
            }
            """;

        var response = await _client.PostAsync("/generate", Json(payload));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Generate_WithInvalidHeader_Returns400OrUnprocessable_WithTheValidatorMessage()
    {
        var payload = """
            {
              "url": "https://example.com",
              "fields": [ { "name": "Titel", "selector": "h1" } ],
              "headers": [ { "name": "Bad Name", "value": "x" } ]
            }
            """;

        var response = await _client.PostAsync("/generate", Json(payload));

        Assert.True(response.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.UnprocessableEntity);
        Assert.Contains("Invalid request header name", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Generate_HeadersTogetherWithApi_Returns400()
    {
        var payload = """
            {
              "url": "https://example.com",
              "headers": [ { "name": "X-A", "value": "x" } ],
              "api": { "urlTemplate": "https://example.com/items", "itemsPath": "items", "fields": [ { "name": "Id", "path": "id" } ] }
            }
            """;

        var response = await _client.PostAsync("/generate", Json(payload));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Headers and Api are mutually exclusive", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Generate_CombinedWithOuterHeaders_Returns400()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Headers = [new ApiHeader { Name = "X-A", Value = "x" }],
            Combined =
            [
                new CombinedComponentConfig { Name = "a", Config = new ScrapingConfig { Url = "https://example.com", Fields = [new ScrapingField { Name = "T", Selector = "h1" }] } },
                new CombinedComponentConfig { Name = "b", Config = new ScrapingConfig { Url = "https://example.com", Fields = [new ScrapingField { Name = "T", Selector = "h1" }] } },
            ],
        };

        var response = await _client.PostAsync("/generate", Json(JsonSerializer.Serialize(config)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Headers", await response.Content.ReadAsStringAsync());
    }
}
