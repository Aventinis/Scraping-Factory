using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #202: /configs/{configId}/outputs endpoints. Same isolated-db setup
// as SavedConfigsEndpointTests (its own WebApplicationFactory pointed at a
// temp SQLite file via Companion:SavedConfigsDbPath), since both feature
// sets live in the same store.
public class SavedOutputsEndpointTests : IDisposable
{
    private readonly string _dbPath;
    private readonly WebApplicationFactory<Program> _factory;
    private readonly HttpClient _client;

    public SavedOutputsEndpointTests()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"sf-saved-outputs-endpoint-test-{Guid.NewGuid():N}.db");
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

    private async Task<long> CreateConfigAsync()
    {
        var created = await (await _client.PostAsync("/configs", JsonBody(new
        {
            url = "https://example.com/products", name = "My config", config = new { fields = Array.Empty<object>() },
        }))).Content.ReadFromJsonAsync<JsonElement>();
        return created.GetProperty("id").GetInt64();
    }

    [Fact]
    public async Task Post_ValidRequest_Returns201WithSummary()
    {
        var configId = await CreateConfigAsync();

        var response = await _client.PostAsync($"/configs/{configId}/outputs", JsonBody(new
        {
            name = "First run", fileName = "output.csv", content = "Titel\nA\n",
        }));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("id").GetInt64() > 0);
        Assert.Equal("First run", body.GetProperty("name").GetString());
        Assert.Equal(configId, body.GetProperty("savedConfigId").GetInt64());
    }

    [Fact]
    public async Task Post_UnknownConfigId_Returns404()
    {
        var response = await _client.PostAsync("/configs/999999/outputs", JsonBody(new
        {
            name = "Run", fileName = "output.csv", content = "a",
        }));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Theory]
    [InlineData(null, "output.csv", "content")]
    [InlineData("name", null, "content")]
    [InlineData("name", "output.csv", null)]
    public async Task Post_MissingField_Returns400(string? name, string? fileName, string? content)
    {
        var configId = await CreateConfigAsync();

        var response = await _client.PostAsync($"/configs/{configId}/outputs", JsonBody(new { name, fileName, content }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Get_ByConfigId_ReturnsSummariesWithoutContent()
    {
        var configId = await CreateConfigAsync();
        await _client.PostAsync($"/configs/{configId}/outputs", JsonBody(new
        {
            name = "Run", fileName = "output.csv", content = "Titel\nA\n",
        }));

        var response = await _client.GetAsync($"/configs/{configId}/outputs");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var list = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, list.GetArrayLength());
        Assert.Equal("Run", list[0].GetProperty("name").GetString());
        JsonElement _;
        Assert.False(list[0].TryGetProperty("content", out _));
    }

    [Fact]
    public async Task Get_ByConfigId_UnknownConfig_Returns404()
    {
        var response = await _client.GetAsync("/configs/999999/outputs");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetById_ExistingId_ReturnsFullContent()
    {
        var configId = await CreateConfigAsync();
        var created = await (await _client.PostAsync($"/configs/{configId}/outputs", JsonBody(new
        {
            name = "Run", fileName = "output.csv", content = "Titel\nA\nB\n",
        }))).Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetInt64();

        var response = await _client.GetAsync($"/configs/{configId}/outputs/{id}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Titel\nA\nB\n", body.GetProperty("content").GetString());
    }

    [Fact]
    public async Task GetById_UnknownId_Returns404()
    {
        var configId = await CreateConfigAsync();
        var response = await _client.GetAsync($"/configs/{configId}/outputs/999999");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetById_MismatchedConfigId_Returns404()
    {
        var configIdA = await CreateConfigAsync();
        var configIdB = await CreateConfigAsync();
        var created = await (await _client.PostAsync($"/configs/{configIdA}/outputs", JsonBody(new
        {
            name = "Run", fileName = "output.csv", content = "a",
        }))).Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetInt64();

        var response = await _client.GetAsync($"/configs/{configIdB}/outputs/{id}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Delete_ExistingId_Returns204AndRemovesIt()
    {
        var configId = await CreateConfigAsync();
        var created = await (await _client.PostAsync($"/configs/{configId}/outputs", JsonBody(new
        {
            name = "Run", fileName = "output.csv", content = "a",
        }))).Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetInt64();

        var deleteResponse = await _client.DeleteAsync($"/configs/{configId}/outputs/{id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        var getResponse = await _client.GetAsync($"/configs/{configId}/outputs/{id}");
        Assert.Equal(HttpStatusCode.NotFound, getResponse.StatusCode);
    }

    [Fact]
    public async Task Delete_UnknownId_Returns404()
    {
        var configId = await CreateConfigAsync();
        var response = await _client.DeleteAsync($"/configs/{configId}/outputs/999999");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Delete_SavedConfig_CascadesToItsOwnOutputs()
    {
        var configId = await CreateConfigAsync();
        var created = await (await _client.PostAsync($"/configs/{configId}/outputs", JsonBody(new
        {
            name = "Run", fileName = "output.csv", content = "a",
        }))).Content.ReadFromJsonAsync<JsonElement>();
        var outputId = created.GetProperty("id").GetInt64();

        var deleteConfigResponse = await _client.DeleteAsync($"/configs/{configId}");
        Assert.Equal(HttpStatusCode.NoContent, deleteConfigResponse.StatusCode);

        var getOutputResponse = await _client.GetAsync($"/configs/{configId}/outputs/{outputId}");
        Assert.Equal(HttpStatusCode.NotFound, getOutputResponse.StatusCode);
    }

    // ── Issue #207: POST /configs/{configId}/outputs/{id}/replay-hardening ──

    private async Task<long> CreateOutputAsync(long configId, string content, string fileName = "output.csv")
    {
        var created = await (await _client.PostAsync($"/configs/{configId}/outputs", JsonBody(new
        {
            name = "Run", fileName, content,
        }))).Content.ReadFromJsonAsync<JsonElement>();
        return created.GetProperty("id").GetInt64();
    }

    [Fact]
    public async Task ReplayHardening_NoResultCheck_AgainstNonEmptyCsv_Passes()
    {
        var configId = await CreateConfigAsync();
        var outputId = await CreateOutputAsync(configId, "Titel\nA\nB\n");

        var response = await _client.PostAsync($"/configs/{configId}/outputs/{outputId}/replay-hardening", JsonBody(new
        {
            checks = new object[] { new { kind = "noResult", severity = "Error" } },
        }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var results = body.GetProperty("results");
        Assert.Equal(1, results.GetArrayLength());
        Assert.Equal("noResult", results[0].GetProperty("kind").GetString());
        Assert.Equal("Passed", results[0].GetProperty("outcome").GetString());
    }

    [Fact]
    public async Task ReplayHardening_NoResultCheck_AgainstEmptyCsv_Triggers()
    {
        var configId = await CreateConfigAsync();
        var outputId = await CreateOutputAsync(configId, "Titel\n");

        var response = await _client.PostAsync($"/configs/{configId}/outputs/{outputId}/replay-hardening", JsonBody(new
        {
            checks = new object[] { new { kind = "noResult", severity = "Error" } },
        }));

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Triggered", body.GetProperty("results")[0].GetProperty("outcome").GetString());
    }

    [Fact]
    public async Task ReplayHardening_UnknownConfigId_Returns404()
    {
        var response = await _client.PostAsync("/configs/999999/outputs/1/replay-hardening", JsonBody(new
        {
            checks = new object[] { new { kind = "noResult", severity = "Error" } },
        }));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task ReplayHardening_MismatchedConfigId_Returns404()
    {
        var configIdA = await CreateConfigAsync();
        var configIdB = await CreateConfigAsync();
        var outputId = await CreateOutputAsync(configIdA, "Titel\nA\n");

        var response = await _client.PostAsync($"/configs/{configIdB}/outputs/{outputId}/replay-hardening", JsonBody(new
        {
            checks = new object[] { new { kind = "noResult", severity = "Error" } },
        }));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task ReplayHardening_NoChecks_Returns400()
    {
        var configId = await CreateConfigAsync();
        var outputId = await CreateOutputAsync(configId, "Titel\nA\n");

        var response = await _client.PostAsync($"/configs/{configId}/outputs/{outputId}/replay-hardening", JsonBody(new { checks = Array.Empty<object>() }));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ReplayHardening_BaselineCheck_CompareBySameConfig_UsesOlderOutputAsPrevious()
    {
        var configId = await CreateConfigAsync();
        await CreateOutputAsync(configId, "Titel\nA\nB\nC\nD\n"); // 4 rows, older
        var newestOutputId = await CreateOutputAsync(configId, "Titel\nA\n"); // 1 row, being evaluated

        var response = await _client.PostAsync($"/configs/{configId}/outputs/{newestOutputId}/replay-hardening", JsonBody(new
        {
            checks = new object[] { new { kind = "baseline", severity = "Error", dropThreshold = 0.1 } },
            compareBasis = "config",
        }));

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var result = body.GetProperty("results")[0];
        Assert.Equal("Triggered", result.GetProperty("outcome").GetString());
        Assert.Contains("4", result.GetProperty("message").GetString());
    }

    [Fact]
    public async Task ReplayHardening_BaselineCheck_NoEarlierOutput_IsInconclusive()
    {
        var configId = await CreateConfigAsync();
        var outputId = await CreateOutputAsync(configId, "Titel\nA\n");

        var response = await _client.PostAsync($"/configs/{configId}/outputs/{outputId}/replay-hardening", JsonBody(new
        {
            checks = new object[] { new { kind = "baseline", severity = "Error", dropThreshold = 0.1 } },
        }));

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Inconclusive", body.GetProperty("results")[0].GetProperty("outcome").GetString());
    }

    [Fact]
    public async Task ReplayHardening_BaselineCheck_CompareByBlueprint_UsesMostRecentOutputAcrossOtherConfig()
    {
        var configA = await (await _client.PostAsync("/configs", JsonBody(new
        {
            url = "https://a.example.com", name = "A",
            config = new { fields = Array.Empty<object>(), outputBlueprint = new { blueprintId = 5, schemaKind = "Flat" } },
        }))).Content.ReadFromJsonAsync<JsonElement>();
        var configIdA = configA.GetProperty("id").GetInt64();

        var configB = await (await _client.PostAsync("/configs", JsonBody(new
        {
            url = "https://b.example.com", name = "B",
            config = new { fields = Array.Empty<object>(), outputBlueprint = new { blueprintId = 5, schemaKind = "Flat" } },
        }))).Content.ReadFromJsonAsync<JsonElement>();
        var configIdB = configB.GetProperty("id").GetInt64();

        await CreateOutputAsync(configIdA, "Titel\nA\nB\nC\nD\n"); // 4 rows, another config sharing the blueprint
        var outputIdB = await CreateOutputAsync(configIdB, "Titel\nA\n"); // 1 row, being evaluated

        var response = await _client.PostAsync($"/configs/{configIdB}/outputs/{outputIdB}/replay-hardening", JsonBody(new
        {
            checks = new object[] { new { kind = "baseline", severity = "Error", dropThreshold = 0.1 } },
            compareBasis = "blueprint",
        }));

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var result = body.GetProperty("results")[0];
        Assert.Equal("Triggered", result.GetProperty("outcome").GetString());
        Assert.Contains("4", result.GetProperty("message").GetString());
    }

    [Fact]
    public async Task ReplayHardening_BaselineCheck_CompareByBlueprint_NoBlueprintSet_IsInconclusiveWithClearReason()
    {
        var configId = await CreateConfigAsync(); // no outputBlueprint set
        var outputId = await CreateOutputAsync(configId, "Titel\nA\n");

        var response = await _client.PostAsync($"/configs/{configId}/outputs/{outputId}/replay-hardening", JsonBody(new
        {
            checks = new object[] { new { kind = "baseline", severity = "Error", dropThreshold = 0.1 } },
            compareBasis = "blueprint",
        }));

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var result = body.GetProperty("results")[0];
        Assert.Equal("Inconclusive", result.GetProperty("outcome").GetString());
        Assert.Contains("Output Blueprint", result.GetProperty("message").GetString());
    }

    [Fact]
    public async Task ReplayHardening_BlockingCheck_IsAlwaysNotEvaluable()
    {
        var configId = await CreateConfigAsync();
        var outputId = await CreateOutputAsync(configId, "Titel\nA\n");

        var response = await _client.PostAsync($"/configs/{configId}/outputs/{outputId}/replay-hardening", JsonBody(new
        {
            checks = new object[] { new { kind = "blocking", severity = "Warning" } },
        }));

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("NotEvaluable", body.GetProperty("results")[0].GetProperty("outcome").GetString());
    }
}
