using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #279: /transform-presets endpoints. Same isolated-
// WebApplicationFactory pattern as OutputBlueprintsEndpointTests (own
// Companion:TransformPresetsDbPath override).
public class TransformPresetsEndpointTests : IDisposable
{
    private readonly string _dbPath;
    private readonly WebApplicationFactory<Program> _factory;
    private readonly HttpClient _client;

    public TransformPresetsEndpointTests()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"sf-transform-presets-endpoint-test-{Guid.NewGuid():N}.db");
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((_, config) =>
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Companion:TransformPresetsDbPath"] = _dbPath,
                })));
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
        if (File.Exists(_dbPath)) File.Delete(_dbPath);
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    private const string PriceChain = """
        [ { "kind": "trim" }, { "kind": "toCurrency", "format": "1.234,56", "onError": "UseDefault", "defaultValue": "0" } ]
        """;

    private Task<HttpResponseMessage> PostPreset(string name, string transformsJson) =>
        _client.PostAsync("/transform-presets", Json($$"""{ "name": {{JsonSerializer.Serialize(name)}}, "transforms": {{transformsJson}} }"""));

    [Fact]
    public async Task Post_ValidChain_Returns201_AndListReturnsTheChainInWireShape()
    {
        var response = await PostPreset("Preis bereinigen", PriceChain);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(created.GetProperty("id").GetInt64() > 0);

        var list = await _client.GetFromJsonAsync<JsonElement>("/transform-presets");
        var preset = Assert.Single(list.EnumerateArray());
        Assert.Equal("Preis bereinigen", preset.GetProperty("name").GetString());
        var steps = preset.GetProperty("transforms").EnumerateArray().ToList();
        Assert.Equal("trim", steps[0].GetProperty("kind").GetString());
        Assert.Equal("toCurrency", steps[1].GetProperty("kind").GetString());
        Assert.Equal("1.234,56", steps[1].GetProperty("format").GetString());
        Assert.Equal("UseDefault", steps[1].GetProperty("onError").GetString());
        Assert.Equal("0", steps[1].GetProperty("defaultValue").GetString());
    }

    [Fact]
    public async Task List_IsOrderedByNameCaseInsensitively()
    {
        await PostPreset("zahl", """[ { "kind": "toNumber" } ]""");
        await PostPreset("Anfang", """[ { "kind": "trim" } ]""");

        var list = await _client.GetFromJsonAsync<JsonElement>("/transform-presets");

        Assert.Equal(["Anfang", "zahl"], list.EnumerateArray().Select(p => p.GetProperty("name").GetString()));
    }

    [Theory]
    [InlineData("", """[ { "kind": "trim" } ]""", "Name is required")]
    [InlineData("Leer", "[]", "at least one transform step")]
    [InlineData("Kombi", """[ { "kind": "combineFields", "sourceFieldNames": ["a", "b"] } ]""", "Combine/split")]
    [InlineData("Teilen", """[ { "kind": "splitField", "sourceFieldName": "a" } ]""", "Combine/split")]
    [InlineData("Regex", """[ { "kind": "regexExtract", "pattern": "(" } ]""", "Invalid regular expression '(' for this preset")]
    [InlineData("Währung", """[ { "kind": "toCurrency", "format": "1234" } ]""", "is not supported")]
    [InlineData("Default", """[ { "kind": "toInteger", "onError": "UseDefault" } ]""", "Default value")]
    public async Task Post_InvalidRequest_Returns400WithReason(string name, string transformsJson, string expectedError)
    {
        var response = await PostPreset(name, transformsJson);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(expectedError, body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Post_UnknownKind_Returns400()
    {
        var response = await PostPreset("Unbekannt", """[ { "kind": "doSomethingElse" } ]""");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Post_DuplicateName_Returns409RegardlessOfCase()
    {
        await PostPreset("Preis bereinigen", PriceChain);
        var response = await PostPreset("preis BEREINIGEN", PriceChain);
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Put_RenamesWithoutTouchingTheChain()
    {
        var id = (await (await PostPreset("Alt", PriceChain)).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();

        var response = await _client.PutAsync($"/transform-presets/{id}", Json("""{ "name": "Neu" }"""));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var preset = Assert.Single((await _client.GetFromJsonAsync<JsonElement>("/transform-presets")).EnumerateArray());
        Assert.Equal("Neu", preset.GetProperty("name").GetString());
        Assert.Equal(2, preset.GetProperty("transforms").GetArrayLength());
    }

    [Fact]
    public async Task Put_ToItsOwnNameWithDifferentCase_IsAllowed_ButToAnotherPresetsNameConflicts()
    {
        var id = (await (await PostPreset("Preis", PriceChain)).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();
        await PostPreset("Text", """[ { "kind": "trim" } ]""");

        Assert.Equal(HttpStatusCode.OK, (await _client.PutAsync($"/transform-presets/{id}", Json("""{ "name": "PREIS" }"""))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await _client.PutAsync($"/transform-presets/{id}", Json("""{ "name": "text" }"""))).StatusCode);
    }

    [Fact]
    public async Task Put_UnknownId_Returns404_BlankName_Returns400()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await _client.PutAsync("/transform-presets/999", Json("""{ "name": "x" }"""))).StatusCode);
        var id = (await (await PostPreset("Preis", PriceChain)).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PutAsync($"/transform-presets/{id}", Json("""{ "name": "  " }"""))).StatusCode);
    }

    [Fact]
    public async Task Delete_RemovesThePreset_UnknownIdReturns404()
    {
        var id = (await (await PostPreset("Preis", PriceChain)).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/transform-presets/{id}")).StatusCode);
        Assert.Empty((await _client.GetFromJsonAsync<JsonElement>("/transform-presets")).EnumerateArray());
        Assert.Equal(HttpStatusCode.NotFound, (await _client.DeleteAsync($"/transform-presets/{id}")).StatusCode);
    }

    [Fact]
    public async Task Presets_SurviveARestartOfTheStore()
    {
        await PostPreset("Preis", PriceChain);

        var reopened = new ScrapingFactory.Companion.TransformPresetStore(_dbPath).ListAll();

        var preset = Assert.Single(reopened);
        Assert.Equal("Preis", preset.Name);
        Assert.IsType<ScrapingFactory.Compiler.IR.ToCurrencyTransform>(preset.Transforms[1]);
    }
}
