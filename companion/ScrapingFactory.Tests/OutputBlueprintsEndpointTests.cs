using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #191: /blueprints endpoints. Same isolated-WebApplicationFactory
// pattern as SavedConfigsEndpointTests (own Companion:OutputBlueprintsDbPath
// override, not the shared CompanionEndpointTests fixture).
public class OutputBlueprintsEndpointTests : IDisposable
{
    private readonly string _dbPath;
    private readonly WebApplicationFactory<Program> _factory;
    private readonly HttpClient _client;

    public OutputBlueprintsEndpointTests()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"sf-output-blueprints-endpoint-test-{Guid.NewGuid():N}.db");
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((_, config) =>
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Companion:OutputBlueprintsDbPath"] = _dbPath,
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
        var response = await _client.PostAsync("/blueprints", JsonBody(new
        {
            name = "Product schema", fieldNames = new[] { "Title", "Price" },
        }));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("id").GetInt64() > 0);
        Assert.Equal("Product schema", body.GetProperty("name").GetString());
        Assert.Equal(2, body.GetProperty("fieldCount").GetInt32());
    }

    [Fact]
    public async Task Post_MissingName_Returns400()
    {
        var response = await _client.PostAsync("/blueprints", JsonBody(new { name = (string?)null, fieldNames = new[] { "A" } }));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Post_EmptyFieldNames_Returns400()
    {
        var response = await _client.PostAsync("/blueprints", JsonBody(new { name = "Name", fieldNames = Array.Empty<string>() }));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Post_DuplicateFieldNames_Returns400()
    {
        var response = await _client.PostAsync("/blueprints", JsonBody(new
        {
            name = "Schema", fieldNames = new[] { "Title", "Title" },
        }));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Post_BlankFieldNamesAreTrimmedAndDropped()
    {
        var response = await _client.PostAsync("/blueprints", JsonBody(new
        {
            name = "Schema", fieldNames = new[] { "  Title  ", " ", "Price" },
        }));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, body.GetProperty("fieldCount").GetInt32());
    }

    [Fact]
    public async Task Get_ListsAllBlueprints()
    {
        await _client.PostAsync("/blueprints", JsonBody(new { name = "A", fieldNames = new[] { "X" } }));
        await _client.PostAsync("/blueprints", JsonBody(new { name = "B", fieldNames = new[] { "Y" } }));

        var response = await _client.GetAsync("/blueprints");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var list = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, list.GetArrayLength());
    }

    [Fact]
    public async Task GetById_ExistingId_ReturnsFullRecordWithFieldNames()
    {
        var created = await (await _client.PostAsync("/blueprints", JsonBody(new
        {
            name = "Product schema", fieldNames = new[] { "Title", "Price" },
        }))).Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetInt64();

        var response = await _client.GetAsync($"/blueprints/{id}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Product schema", body.GetProperty("name").GetString());
        Assert.Equal("Title", body.GetProperty("fieldNames")[0].GetString());
        Assert.Equal("Price", body.GetProperty("fieldNames")[1].GetString());
    }

    [Fact]
    public async Task GetById_UnknownId_Returns404()
    {
        var response = await _client.GetAsync("/blueprints/999999");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Put_ExistingId_UpdatesNameAndFieldNames()
    {
        var created = await (await _client.PostAsync("/blueprints", JsonBody(new
        {
            name = "Old name", fieldNames = new[] { "A" },
        }))).Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetInt64();

        var putResponse = await _client.PutAsync($"/blueprints/{id}", JsonBody(new
        {
            name = "New name", fieldNames = new[] { "A", "B" },
        }));
        Assert.Equal(HttpStatusCode.OK, putResponse.StatusCode);

        var getResponse = await _client.GetAsync($"/blueprints/{id}");
        var body = await getResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("New name", body.GetProperty("name").GetString());
        Assert.Equal(2, body.GetProperty("fieldNames").GetArrayLength());
    }

    [Fact]
    public async Task Put_UnknownId_Returns404()
    {
        var response = await _client.PutAsync("/blueprints/999999", JsonBody(new
        {
            name = "Name", fieldNames = new[] { "A" },
        }));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Delete_ExistingId_Returns204AndRemovesIt()
    {
        var created = await (await _client.PostAsync("/blueprints", JsonBody(new
        {
            name = "Schema", fieldNames = new[] { "A" },
        }))).Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetInt64();

        var deleteResponse = await _client.DeleteAsync($"/blueprints/{id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        var getResponse = await _client.GetAsync($"/blueprints/{id}");
        Assert.Equal(HttpStatusCode.NotFound, getResponse.StatusCode);
    }

    [Fact]
    public async Task Delete_UnknownId_Returns404()
    {
        var response = await _client.DeleteAsync("/blueprints/999999");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // Issue #244: schemaKind: "tree" — the endpoint's own request-shape
    // switch, mirroring the flat "fieldNames" tests above one-for-one.
    private static object TreeSchema() => new
    {
        name = "Menu schema",
        schemaKind = "tree",
        tree = new object[]
        {
            new
            {
                name = "Kategorien",
                children = new object[]
                {
                    new { name = "Name" },
                    new { name = "Gerichte", children = new object[] { new { name = "Preis" } } },
                },
            },
        },
    };

    [Fact]
    public async Task Post_TreeSchema_Returns201WithLeafFieldCount()
    {
        var response = await _client.PostAsync("/blueprints", JsonBody(TreeSchema()));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("tree", body.GetProperty("schemaKind").GetString());
        Assert.Equal(2, body.GetProperty("fieldCount").GetInt32()); // "Name" + "Preis"
    }

    [Fact]
    public async Task Post_TreeSchema_EmptyTree_Returns400()
    {
        var response = await _client.PostAsync("/blueprints", JsonBody(new { name = "Schema", schemaKind = "tree", tree = Array.Empty<object>() }));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Post_TreeSchema_BlankNodeName_Returns400()
    {
        var response = await _client.PostAsync("/blueprints", JsonBody(new
        {
            name = "Schema", schemaKind = "tree", tree = new object[] { new { name = "" } },
        }));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Post_UnknownSchemaKind_Returns400()
    {
        var response = await _client.PostAsync("/blueprints", JsonBody(new { name = "Schema", schemaKind = "nested", fieldNames = new[] { "A" } }));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task GetById_TreeSchema_ReturnsNestedTree()
    {
        var created = await (await _client.PostAsync("/blueprints", JsonBody(TreeSchema()))).Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetInt64();

        var response = await _client.GetAsync($"/blueprints/{id}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("tree", body.GetProperty("schemaKind").GetString());
        var root = body.GetProperty("tree")[0];
        Assert.Equal("Kategorien", root.GetProperty("name").GetString());
        Assert.Equal(2, root.GetProperty("children").GetArrayLength());
    }

    [Fact]
    public async Task Put_FlatToTreeSchema_SwitchesSchemaKind()
    {
        var created = await (await _client.PostAsync("/blueprints", JsonBody(new
        {
            name = "Schema", fieldNames = new[] { "A" },
        }))).Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetInt64();

        var putResponse = await _client.PutAsync($"/blueprints/{id}", JsonBody(TreeSchema()));
        Assert.Equal(HttpStatusCode.OK, putResponse.StatusCode);

        var getResponse = await _client.GetAsync($"/blueprints/{id}");
        var body = await getResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("tree", body.GetProperty("schemaKind").GetString());
        Assert.Equal(2, body.GetProperty("tree")[0].GetProperty("children").GetArrayLength());
    }
}
