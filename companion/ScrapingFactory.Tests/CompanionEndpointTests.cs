using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using ScrapingFactory.Companion.Verification;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class CompanionEndpointTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    // /generate now verifies against the live page before responding, so
    // every test that expects it to succeed needs a stubbed page fetch —
    // real network access in tests would be slow and flaky. Health/
    // validation-only tests don't touch verification and keep using the
    // plain factory client.
    private readonly HttpClient _client = factory.CreateClient();

    private static HttpClient ClientReturningPage(WebApplicationFactory<Program> factory, string html) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.AddHttpClient<ScrapingVerifier>()
                .ConfigurePrimaryHttpMessageHandler(() => FakeHttpMessageHandler.ReturningHtml(html))
        )).CreateClient();

    [Fact]
    public async Task Health_Returns200()
    {
        var response = await _client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Generate_ValidConfig_Returns200WithTextPlain()
    {
        var client = ClientReturningPage(factory, "<html><body><h1>Titel</h1></body></html>");
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }]
        };

        var content = new StringContent(
            JsonSerializer.Serialize(config),
            Encoding.UTF8,
            "application/json");

        var response = await client.PostAsync("/generate", content);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/plain", response.Content.Headers.ContentType?.MediaType);

        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("https://example.com", body);
        Assert.Contains("import requests", body);
    }

    [Fact]
    public async Task Generate_SelectorMatchesNothing_Returns422WithFieldDetails()
    {
        var client = ClientReturningPage(factory, "<html><body><h1>Titel</h1></body></html>");
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields =
            [
                new ScrapingField { Name = "Titel", Selector = "h1" },
                new ScrapingField { Name = "Preis", Selector = ".price" },
            ],
        };

        var content = new StringContent(JsonSerializer.Serialize(config), Encoding.UTF8, "application/json");
        var response = await client.PostAsync("/generate", content);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var fields = doc.RootElement.GetProperty("fields").EnumerateArray().ToList();
        Assert.Equal(2, fields.Count);

        var priceField = fields.Single(f => f.GetProperty("name").GetString() == "Preis");
        Assert.Equal(0, priceField.GetProperty("matchCount").GetInt32());
        Assert.False(priceField.GetProperty("success").GetBoolean());

        var titleField = fields.Single(f => f.GetProperty("name").GetString() == "Titel");
        Assert.True(titleField.GetProperty("success").GetBoolean());
    }

    [Fact]
    public async Task Generate_PageUnreachable_Returns422WithError()
    {
        var client = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.AddHttpClient<ScrapingVerifier>()
                .ConfigurePrimaryHttpMessageHandler(() => FakeHttpMessageHandler.Throwing(new HttpRequestException("Connection refused")))
        )).CreateClient();

        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
        };
        var content = new StringContent(JsonSerializer.Serialize(config), Encoding.UTF8, "application/json");

        var response = await client.PostAsync("/generate", content);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Contains("Connection refused", doc.RootElement.GetProperty("error").GetString());
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
        var client = ClientReturningPage(factory, "<html><body><h1>Titel</h1></body></html>");
        const string payload = """
            {
              "version": "1",
              "url": "https://example.com",
              "fields": [ { "name": "Titel", "selector": "h1", "attribute": null } ],
              "outputFormat": "Csv"
            }
            """;
        var content = new StringContent(payload, Encoding.UTF8, "application/json");

        var response = await client.PostAsync("/generate", content);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
