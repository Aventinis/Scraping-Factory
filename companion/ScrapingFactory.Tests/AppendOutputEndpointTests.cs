using System.Net;
using System.Text;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #342: /generate's request-level rules for appendOutput.
public class AppendOutputEndpointTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<(HttpStatusCode Status, string Body)> PostAsync(string payload)
    {
        var response = await _client.PostAsync("/generate", new StringContent(payload, Encoding.UTF8, "application/json"));
        return (response.StatusCode, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task CombinedOuterRequest_IsRejected()
    {
        var (status, body) = await PostAsync("""
            {
              "url": "https://example.invalid/",
              "appendOutput": true,
              "combined": [
                { "name": "a", "config": { "url": "https://a.example.invalid/", "fields": [ { "name": "T", "selector": "h1" } ] } },
                { "name": "b", "config": { "url": "https://b.example.invalid/", "fields": [ { "name": "T", "selector": "h1" } ] } }
              ]
            }
            """);

        Assert.True(HttpStatusCode.BadRequest == status, body);
        Assert.Contains("AppendOutput", body);
    }

    [Fact]
    public async Task ACombinedComponent_MayAppendItsOwnOutput()
    {
        var (status, body) = await PostAsync("""
            {
              "url": "https://example.invalid/",
              "skipVerification": true,
              "combined": [
                { "name": "a", "config": { "url": "https://a.example.invalid/", "appendOutput": true, "fields": [ { "name": "T", "selector": "h1" } ] } },
                { "name": "b", "config": { "url": "https://b.example.invalid/", "fields": [ { "name": "T", "selector": "h1" } ] } }
              ]
            }
            """);

        Assert.True(HttpStatusCode.OK == status, body);
    }

    [Fact]
    public async Task TheTrialRun_AlwaysWorksOnAFreshDirectory()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var (status, body) = await PostAsync($$"""
            { "url": "{{server.BaseUrl}}", "appendOutput": true, "outputFormat": "Csv", "fields": [ { "name": "T", "selector": "h1" } ] }
            """);

        Assert.True(HttpStatusCode.OK == status, body);
        Assert.Contains("_append_previous_rows", body);
    }
}
