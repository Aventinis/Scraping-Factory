using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using ScrapingFactory.Companion.Storage;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #277: choosing the storage backend — configuration parsing and
// validation, the startup check, the DI selection, and the end-to-end
// endpoints on MySQL (needs SF_TEST_MYSQL, see MySqlFactAttribute).
public class StorageProviderTests
{
    private static IConfiguration Config(params (string Key, string? Value)[] values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values.ToDictionary(v => v.Key, v => v.Value)).Build();

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Sqlite")]
    [InlineData("sqlite")]
    public void ResolveProvider_DefaultsToSqlite(string? configured) =>
        Assert.Equal(StorageOptions.Provider.Sqlite, StorageOptions.ResolveProvider(Config((StorageOptions.ProviderKey, configured))));

    [Theory]
    [InlineData("MySql")]
    [InlineData("mysql")]
    [InlineData(" MYSQL ")]
    public void ResolveProvider_RecognizesMySql(string configured) =>
        Assert.Equal(StorageOptions.Provider.MySql, StorageOptions.ResolveProvider(Config((StorageOptions.ProviderKey, configured))));

    [Fact]
    public void ResolveProvider_RejectsAnUnknownProvider()
    {
        var error = Assert.Throws<InvalidOperationException>(() => StorageOptions.ResolveProvider(Config((StorageOptions.ProviderKey, "Postgres"))));
        Assert.Contains("Postgres", error.Message);
        Assert.Contains("Sqlite", error.Message);
    }

    [Fact]
    public void Validate_MySqlWithoutAConnectionString_Fails()
    {
        var error = Assert.Throws<InvalidOperationException>(() => StorageOptions.Validate(Config((StorageOptions.ProviderKey, "MySql"))));
        Assert.Contains(StorageOptions.MySqlConnectionStringKey, error.Message);
    }

    [Fact]
    public void Validate_MySqlWithAMalformedConnectionString_Fails() =>
        Assert.ThrowsAny<ArgumentException>(() => StorageOptions.Validate(Config(
            (StorageOptions.ProviderKey, "MySql"), (StorageOptions.MySqlConnectionStringKey, "this is not a connection string"))));

    [Fact]
    public void Validate_SqliteNeedsNothing() => StorageOptions.Validate(Config());

    [Fact]
    public void TheConnectionString_ReportsMatchedRowsForUpdates()
    {
        var connectionString = StorageOptions.BuildMySqlConnectionString(Config(
            (StorageOptions.MySqlConnectionStringKey, "Server=db;Database=sf;User ID=u;Password=p;UseAffectedRows=true")));
        Assert.Contains("Use Affected Rows=False", connectionString, StringComparison.OrdinalIgnoreCase);
    }

    private static StringContent Json(string payload) => new(payload, Encoding.UTF8, "application/json");

    [Fact]
    public void TheCompanion_RefusesToStartWithMySqlButNoConnectionString()
    {
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseSetting(StorageOptions.ProviderKey, "MySql"));
        var error = Assert.ThrowsAny<Exception>(() => factory.CreateClient());
        Assert.Contains(StorageOptions.MySqlConnectionStringKey, error.ToString());
    }

    [Fact]
    public async Task AnUnreachableDatabase_AnswersWith503AndAReadableMessage()
    {
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseSetting(StorageOptions.ProviderKey, "MySql")
                .UseSetting(StorageOptions.MySqlConnectionStringKey, "Server=127.0.0.1;Port=1;Database=sf;User ID=u;Password=p;Connection Timeout=2"));
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/configs");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Contains("storage database is not available", document.RootElement.GetProperty("error").GetString());
        // /health and /generate never touch the database.
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);
    }

    [MySqlFact]
    public async Task WithMySql_AllThreeEndpointFamiliesWorkAgainstTheDatabase()
    {
        using var database = new MySqlTestDatabase();
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseSetting(StorageOptions.ProviderKey, "MySql")
                .UseSetting(StorageOptions.MySqlConnectionStringKey, database.ConnectionString));
        using var client = factory.CreateClient();

        var saved = await client.PostAsync("/configs", Json("""{ "url": "https://example.com/a", "name": "On MySQL", "config": { "url": "https://example.com/a" } }"""));
        Assert.Equal(HttpStatusCode.Created, saved.StatusCode);
        var id = (await saved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();
        var listed = await client.GetFromJsonAsync<JsonElement>("/configs?url=https://example.com/b");
        Assert.Equal("On MySQL", listed[0].GetProperty("name").GetString());

        var output = await client.PostAsync($"/configs/{id}/outputs", Json("""{ "name": "run", "fileName": "output.csv", "content": "a\n1\n" }"""));
        Assert.Equal(HttpStatusCode.Created, output.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/configs/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/configs/{id}")).StatusCode);

        var blueprint = await client.PostAsync("/blueprints", Json("""{ "name": "Shop", "fieldNames": ["Titel", "Preis"] }"""));
        Assert.Equal(HttpStatusCode.Created, blueprint.StatusCode);
        var blueprints = await client.GetFromJsonAsync<JsonElement>("/blueprints");
        Assert.Equal(2, blueprints[0].GetProperty("fieldCount").GetInt32());

        var preset = await client.PostAsync("/transform-presets", Json("""{ "name": "Trim", "transforms": [ { "kind": "trim" } ] }"""));
        Assert.Equal(HttpStatusCode.Created, preset.StatusCode);
        var duplicate = await client.PostAsync("/transform-presets", Json("""{ "name": "trim", "transforms": [ { "kind": "trim" } ] }"""));
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
    }
}
