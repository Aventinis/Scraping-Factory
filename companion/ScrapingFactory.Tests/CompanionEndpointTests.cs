using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class CompanionEndpointTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Health_Returns200()
    {
        var response = await _client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Generate_ValidConfig_Returns200WithTextPlain()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }]
        };

        var content = new StringContent(
            JsonSerializer.Serialize(config),
            Encoding.UTF8,
            "application/json");

        var response = await _client.PostAsync("/generate", content);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/plain", response.Content.Headers.ContentType?.MediaType);

        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("https://example.com", body);
        Assert.Contains("import requests", body);
    }

    [Fact]
    public async Task Generate_MissingUrl_Returns400()
    {
        var payload = JsonSerializer.Serialize(new { Fields = new[] { new { Name = "x", Selector = "h1" } } });
        var content = new StringContent(payload, Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/generate", content);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Generate_EmptyFields_Returns400()
    {
        var config = new ScrapingConfig { Url = "https://example.com" };
        var content = new StringContent(
            JsonSerializer.Serialize(config),
            Encoding.UTF8,
            "application/json");

        var response = await _client.PostAsync("/generate", content);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // Reproduces the exact wire format sent by the browser extension
    // (camelCase property names, outputFormat as a string) — this is
    // what regressed to always return 400 without a JsonStringEnumConverter.
    [Fact]
    public async Task Generate_ExtensionStylePayload_Returns200()
    {
        const string payload = """
            {
              "version": "1",
              "url": "https://example.com",
              "fields": [ { "name": "Titel", "selector": "h1", "attribute": null } ],
              "outputFormat": "Csv"
            }
            """;
        var content = new StringContent(payload, Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/generate", content);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
