using System.Net;
using System.Text;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #333: /generate's request-level rules for robotsDisallow.
public class RobotsDisallowEndpointTests(WebApplicationFactory<Program> factory)
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
              "robotsDisallow": { "action": "Skip" },
              "combined": [
                { "name": "a", "config": { "url": "https://a.example.invalid/", "fields": [ { "name": "T", "selector": "h1" } ] } },
                { "name": "b", "config": { "url": "https://b.example.invalid/", "fields": [ { "name": "T", "selector": "h1" } ] } }
              ]
            }
            """);

        Assert.True(HttpStatusCode.BadRequest == status, body);
        Assert.Contains("RobotsDisallow", body);
    }

    [Fact]
    public async Task ACombinedComponent_MayCarryItsOwn()
    {
        var (status, body) = await PostAsync("""
            {
              "url": "https://example.invalid/",
              "skipVerification": true,
              "combined": [
                { "name": "a", "config": { "url": "https://a.example.invalid/", "robotsDisallow": { "action": "Warn" }, "fields": [ { "name": "T", "selector": "h1" } ] } },
                { "name": "b", "config": { "url": "https://b.example.invalid/", "fields": [ { "name": "T", "selector": "h1" } ] } }
              ]
            }
            """);

        Assert.True(HttpStatusCode.OK == status, body);
    }

    [Fact]
    public async Task UnknownAction_IsAnInvalidRequest()
    {
        var (status, _) = await PostAsync("""
            { "url": "https://example.invalid/", "robotsDisallow": { "action": "Explode" }, "fields": [ { "name": "T", "selector": "h1" } ] }
            """);
        Assert.Equal(HttpStatusCode.BadRequest, status);
    }
}
