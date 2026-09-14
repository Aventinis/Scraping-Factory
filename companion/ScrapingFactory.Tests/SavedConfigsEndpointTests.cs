using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #141: /configs endpoints. Deliberately builds its own
// WebApplicationFactory (via WithWebHostBuilder, not the shared
// IClassFixture<WebApplicationFactory<Program>> CompanionEndpointTests uses)
// so Companion:SavedConfigsDbPath can be pointed at an isolated temp file —
// without this override, SavedConfigStore would default to the real
// per-user app-data path even during test runs.
public class SavedConfigsEndpointTests : IDisposable
{
    private readonly string _dbPath;
    private readonly WebApplicationFactory<Program> _factory;
    private readonly HttpClient _client;

    public SavedConfigsEndpointTests()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"sf-saved-configs-endpoint-test-{Guid.NewGuid():N}.db");
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((_, config) =>
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Companion:SavedConfigsDbPath"] = _dbPath,
                })));
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
        if (File.Exists(_dbPath)) File.Delete(_dbPath);
    }

    private static StringContent JsonBody(object value) =>
        new(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json");

    [Fact]
    public async Task Post_ValidRequest_Returns201WithId()
    {
        var response = await _client.PostAsync("/configs", JsonBody(new
        {
            url = "https://example.com/products",
            name = "My config",
            config = new { url = "https://example.com/products", fields = Array.Empty<object>() },
        }));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("id").GetInt64() > 0);
        Assert.Equal("My config", body.GetProperty("name").GetString());
    }

    [Theory]
    [InlineData(null, "name")]
    [InlineData("https://example.com", null)]
    public async Task Post_MissingUrlOrName_Returns400(string? url, string? name)
    {
        var response = await _client.PostAsync("/configs", JsonBody(new { url, name, config = new { } }));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Post_ConfigNotAnObject_Returns400()
    {
        var response = await _client.PostAsync("/configs", JsonBody(new { url = "https://example.com", name = "x", config = "not-an-object" }));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Get_ByUrl_ReturnsSavedConfigsForSameHost()
    {
        await _client.PostAsync("/configs", JsonBody(new
        {
            url = "https://shop.example.com/a", name = "Config A", config = new { a = 1 },
        }));
        await _client.PostAsync("/configs", JsonBody(new
        {
            url = "https://other.example.com/b", name = "Config B", config = new { b = 2 },
        }));

        var response = await _client.GetAsync("/configs?url=https://shop.example.com/different-page");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var list = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, list.GetArrayLength());
        Assert.Equal("Config A", list[0].GetProperty("name").GetString());
    }

    [Fact]
    public async Task Get_WithoutUrlQueryParam_Returns400()
    {
        var response = await _client.GetAsync("/configs");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task GetById_ExistingId_ReturnsFullConfig()
    {
        var created = await (await _client.PostAsync("/configs", JsonBody(new
        {
            url = "https://example.com/products", name = "My config", config = new { fields = new[] { "a" } },
        }))).Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetInt64();

        var response = await _client.GetAsync($"/configs/{id}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("My config", body.GetProperty("name").GetString());
        Assert.Equal("a", body.GetProperty("config").GetProperty("fields")[0].GetString());
    }

    [Fact]
    public async Task GetById_UnknownId_Returns404()
    {
        var response = await _client.GetAsync("/configs/999999");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Delete_ExistingId_Returns204AndRemovesIt()
    {
        var created = await (await _client.PostAsync("/configs", JsonBody(new
        {
            url = "https://example.com/products", name = "My config", config = new { },
        }))).Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetInt64();

        var deleteResponse = await _client.DeleteAsync($"/configs/{id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        var getResponse = await _client.GetAsync($"/configs/{id}");
        Assert.Equal(HttpStatusCode.NotFound, getResponse.StatusCode);
    }

    [Fact]
    public async Task Delete_UnknownId_Returns404()
    {
        var response = await _client.DeleteAsync("/configs/999999");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
