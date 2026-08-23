using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class CompanionEndpointTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    // /generate now actually runs the generated script (a real Python
    // subprocess making its own HTTP request) before responding, so tests
    // that expect it to succeed need a real, reachable page — LocalTestServer
    // serves canned HTML on loopback instead of depending on the internet.
    // Health/validation-only tests never reach verification and keep using
    // the plain factory client.
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
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
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
        Assert.Contains(server.BaseUrl, body);
        Assert.Contains("import requests", body);
    }

    [Fact]
    public async Task Generate_SelectorMatchesNothing_Returns422WithError()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Fields = [new ScrapingField { Name = "Preis", Selector = ".price" }],
        };

        var content = new StringContent(JsonSerializer.Serialize(config), Encoding.UTF8, "application/json");
        var response = await _client.PostAsync("/generate", content);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Contains("keine Daten", doc.RootElement.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Generate_PageUnreachable_Returns422WithError()
    {
        var config = new ScrapingConfig
        {
            Url = "http://127.0.0.1:1/nope", // privileged port, essentially never listening
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
        };
        var content = new StringContent(JsonSerializer.Serialize(config), Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/generate", content);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.False(string.IsNullOrWhiteSpace(doc.RootElement.GetProperty("error").GetString()));
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
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var payload = $$"""
            {
              "version": "1",
              "url": "{{server.BaseUrl}}",
              "fields": [ { "name": "Titel", "selector": "h1", "attribute": null } ],
              "outputFormat": "Csv"
            }
            """;
        var content = new StringContent(payload, Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/generate", content);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
