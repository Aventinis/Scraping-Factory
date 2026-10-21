using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ScrapingFactory.Companion;
using ScrapingFactory.Companion.Auth;
using ScrapingFactory.Companion.Storage;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #278: optional per-user authentication — the user store, the
// ownership scoping of every store (SQLite + MySQL), the 401 middleware, the
// isolation of two users through the real endpoints, and the `user` commands.

// ── User store contract ──────────────────────────────────────────────────────

internal static class UserStoreContract
{
    public static void CreateFindListRotateRemove(IUserStore store)
    {
        var (alice, aliceKey) = store.Create("alice");
        var (bob, bobKey) = store.Create("Bob");

        Assert.True(alice.Id > 0 && bob.Id > alice.Id);          // 0 is reserved for "no authentication"
        Assert.StartsWith(ApiKeys.Prefix, aliceKey);
        Assert.NotEqual(aliceKey, bobKey);
        Assert.Equal("alice", store.FindByKey(aliceKey)!.Name);
        Assert.Equal("Bob", store.FindByKey(bobKey)!.Name);
        Assert.Null(store.FindByKey("sf_not-a-key"));
        Assert.Equal(alice.Id, store.FindByName("ALICE")!.Id);   // names are case-insensitive
        Assert.Equal(["alice", "Bob"], store.List().Select(u => u.Name));

        var rotated = store.RotateKey("alice")!;
        Assert.NotEqual(aliceKey, rotated);
        Assert.Null(store.FindByKey(aliceKey));                  // the old key stops working
        Assert.Equal("alice", store.FindByKey(rotated)!.Name);
        Assert.Null(store.RotateKey("nobody"));

        Assert.True(store.Remove("alice"));
        Assert.False(store.Remove("alice"));
        Assert.Null(store.FindByKey(rotated));
    }

    public static void ADuplicateNameIsRejected_AnyCase(IUserStore store)
    {
        store.Create("alice");
        var error = Assert.Throws<InvalidOperationException>(() => store.Create("ALICE"));
        Assert.Contains("already exists", error.Message);
    }

    public static void OnlyTheHashIsStored(IUserStore store, Func<string> readStoredHashes)
    {
        var (_, key) = store.Create("alice");
        var stored = readStoredHashes();
        Assert.DoesNotContain(key, stored);
        Assert.Contains(ApiKeys.Hash(key), stored);
    }
}

public class SqliteUserStoreTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"sf-users-{Guid.NewGuid():N}.db");
    private IUserStore Store() => new SqliteUserStore(_path);

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (File.Exists(_path)) File.Delete(_path);
    }

    [Fact] public void Crud() => UserStoreContract.CreateFindListRotateRemove(Store());
    [Fact] public void Duplicate() => UserStoreContract.ADuplicateNameIsRejected_AnyCase(Store());

    [Fact]
    public void OnlyTheHashIsStored() => UserStoreContract.OnlyTheHashIsStored(Store(), () =>
    {
        using var connection = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={_path}");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT group_concat(KeyHash) FROM Users;";
        return (string)command.ExecuteScalar()!;
    });
}

public class MySqlUserStoreTests
{
    [MySqlFact]
    public void Crud()
    {
        using var database = new MySqlTestDatabase();
        UserStoreContract.CreateFindListRotateRemove(new MySqlUserStore(database.ConnectionString));
    }

    [MySqlFact]
    public void Duplicate()
    {
        using var database = new MySqlTestDatabase();
        UserStoreContract.ADuplicateNameIsRejected_AnyCase(new MySqlUserStore(database.ConnectionString));
    }
}

// ── Ownership scoping, written once, run on SQLite and MySQL ─────────────────

internal static class OwnershipContract
{
    public static void SavedConfigs_AreInvisibleToOtherOwners(ISavedConfigStore store)
    {
        var mine = store.Save("https://example.com/a", "mine", "{}", blueprintId: 5, ownerId: 1);
        store.Save("https://example.com/b", "theirs", "{}", ownerId: 2);
        store.Save("https://example.com/c", "nobody's", "{}");

        Assert.Equal(["mine"], store.ListByUrl("https://example.com", ownerId: 1).Select(c => c.Name));
        Assert.Equal(["mine"], store.ListAll(ownerId: 1).Select(c => c.Name));
        Assert.Equal(["nobody's"], store.ListAll().Select(c => c.Name));       // owner 0 = today's behavior
        Assert.NotNull(store.Get(mine.Id, ownerId: 1));
        Assert.Null(store.Get(mine.Id, ownerId: 2));
        Assert.Null(store.Get(mine.Id));
        Assert.False(store.Delete(mine.Id, ownerId: 2));
        Assert.NotNull(store.Get(mine.Id, ownerId: 1));
        Assert.True(store.Delete(mine.Id, ownerId: 1));
    }

    public static void SavedOutputs_FollowTheirConfigsOwner(ISavedConfigStore store)
    {
        var config = store.Save("https://example.com", "c", "{}", blueprintId: 9, ownerId: 1);
        var first = store.SaveOutput(config.Id, "first", "o.csv", "1", ownerId: 1);
        Thread.Sleep(5);
        var second = store.SaveOutput(config.Id, "second", "o.csv", "2", ownerId: 1);

        Assert.Throws<KeyNotFoundException>(() => store.SaveOutput(config.Id, "intruder", "o.csv", "x", ownerId: 2));
        Assert.Throws<KeyNotFoundException>(() => store.SaveOutput(config.Id, "anonymous", "o.csv", "x"));

        Assert.Equal(2, store.ListOutputsByConfigId(config.Id, ownerId: 1).Count);
        Assert.Empty(store.ListOutputsByConfigId(config.Id, ownerId: 2));
        Assert.NotNull(store.GetOutput(first.Id, ownerId: 1));
        Assert.Null(store.GetOutput(first.Id, ownerId: 2));
        Assert.False(store.DeleteOutput(first.Id, ownerId: 2));
        Assert.Equal(first.Id, store.GetMostRecentOutputForConfig(config.Id, second.Id, ownerId: 1)!.Id);
        Assert.Null(store.GetMostRecentOutputForConfig(config.Id, second.Id, ownerId: 2));
        Assert.Equal(first.Id, store.GetMostRecentOutputForBlueprint(9, second.Id, ownerId: 1)!.Id);
        Assert.Null(store.GetMostRecentOutputForBlueprint(9, second.Id, ownerId: 2));
        Assert.True(store.DeleteOutput(first.Id, ownerId: 1));
    }

    public static void Blueprints_AreScopedToTheirOwner(IOutputBlueprintStore store)
    {
        var mine = store.Save("shared name", "Flat", ["A"], null, ownerId: 1);
        store.Save("shared name", "Flat", ["B"], null, ownerId: 2);

        Assert.Equal(["A"], store.Get(mine.Id, ownerId: 1)!.FieldNames);
        Assert.Null(store.Get(mine.Id, ownerId: 2));
        Assert.Single(store.ListAll(ownerId: 1));
        Assert.Empty(store.ListAll());
        Assert.False(store.Update(mine.Id, "hijacked", "Flat", ["X"], null, ownerId: 2));
        Assert.False(store.Delete(mine.Id, ownerId: 2));
        Assert.True(store.Update(mine.Id, "renamed", "Flat", ["A2"], null, ownerId: 1));
        Assert.Equal("renamed", store.Get(mine.Id, ownerId: 1)!.Name);
    }

    public static void Presets_AreScopedAndNamesAreUniquePerOwner(ITransformPresetStore store)
    {
        var mine = store.Save("Clean", [new TrimTransform()], ownerId: 1);

        Assert.True(store.NameTaken("clean", ownerId: 1));
        Assert.False(store.NameTaken("clean", ownerId: 2));        // another user may use the same name
        store.Save("Clean", [new TrimTransform()], ownerId: 2);
        Assert.True(store.Exists(mine.Id, ownerId: 1));
        Assert.False(store.Exists(mine.Id, ownerId: 2));
        Assert.Single(store.ListAll(ownerId: 1));
        Assert.Empty(store.ListAll());
        Assert.False(store.Rename(mine.Id, "x", ownerId: 2));
        Assert.False(store.Delete(mine.Id, ownerId: 2));
        Assert.True(store.Delete(mine.Id, ownerId: 1));
    }

    public static void ClaimUnowned_HandsOverOnlyOwnerZeroRows(ISavedConfigStore configs, IOutputBlueprintStore blueprints, ITransformPresetStore presets)
    {
        configs.Save("https://example.com", "old", "{}");
        configs.Save("https://example.com", "someone else's", "{}", ownerId: 2);
        blueprints.Save("old blueprint", "Flat", ["A"], null);
        presets.Save("old preset", [new TrimTransform()]);

        Assert.Equal(1, configs.ClaimUnowned(1));
        Assert.Equal(1, blueprints.ClaimUnowned(1));
        Assert.Equal(1, presets.ClaimUnowned(1));
        Assert.Equal(0, configs.ClaimUnowned(1));

        Assert.Equal(["old"], configs.ListAll(ownerId: 1).Select(c => c.Name));
        Assert.Empty(configs.ListAll());
        Assert.Equal(["someone else's"], configs.ListAll(ownerId: 2).Select(c => c.Name));
        Assert.Single(blueprints.ListAll(ownerId: 1));
        Assert.Single(presets.ListAll(ownerId: 1));
    }
}

public class SqliteOwnershipTests : IDisposable
{
    private readonly List<string> _files = [];
    private string Path_() { var path = Path.Combine(Path.GetTempPath(), $"sf-owner-{Guid.NewGuid():N}.db"); _files.Add(path); return path; }

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        foreach (var file in _files) if (File.Exists(file)) File.Delete(file);
    }

    [Fact] public void SavedConfigs() => OwnershipContract.SavedConfigs_AreInvisibleToOtherOwners(new SavedConfigStore(Path_()));
    [Fact] public void SavedOutputs() => OwnershipContract.SavedOutputs_FollowTheirConfigsOwner(new SavedConfigStore(Path_()));
    [Fact] public void Blueprints() => OwnershipContract.Blueprints_AreScopedToTheirOwner(new OutputBlueprintStore(Path_()));
    [Fact] public void Presets() => OwnershipContract.Presets_AreScopedAndNamesAreUniquePerOwner(new TransformPresetStore(Path_()));
    [Fact] public void Claim() => OwnershipContract.ClaimUnowned_HandsOverOnlyOwnerZeroRows(new SavedConfigStore(Path_()), new OutputBlueprintStore(Path_()), new TransformPresetStore(Path_()));

    [Fact]
    public void ADatabaseFromBeforeAuthentication_GetsOwnerZeroForItsRows()
    {
        var path = Path_();
        using (var connection = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={path}"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = """
                CREATE TABLE SavedConfigs (Id INTEGER PRIMARY KEY AUTOINCREMENT, Url TEXT NOT NULL, Host TEXT NOT NULL, Name TEXT NOT NULL, SavedAt TEXT NOT NULL, ConfigJson TEXT NOT NULL);
                INSERT INTO SavedConfigs (Url, Host, Name, SavedAt, ConfigJson) VALUES ('https://old.example', 'old.example', 'old', '2026-01-01T00:00:00.0000000+00:00', '{}');
                """;
            command.ExecuteNonQuery();
        }

        var store = new SavedConfigStore(path);

        Assert.Equal(["old"], store.ListAll().Select(c => c.Name));          // still visible without authentication
        Assert.Empty(store.ListAll(ownerId: 1));
    }
}

public class MySqlOwnershipTests
{
    private static void With(Action<string> test)
    {
        using var database = new MySqlTestDatabase();
        test(database.ConnectionString);
    }

    [MySqlFact] public void SavedConfigs() => With(c => OwnershipContract.SavedConfigs_AreInvisibleToOtherOwners(new MySqlSavedConfigStore(c)));
    [MySqlFact] public void SavedOutputs() => With(c => OwnershipContract.SavedOutputs_FollowTheirConfigsOwner(new MySqlSavedConfigStore(c)));
    [MySqlFact] public void Blueprints() => With(c => OwnershipContract.Blueprints_AreScopedToTheirOwner(new MySqlOutputBlueprintStore(c)));
    [MySqlFact] public void Presets() => With(c => OwnershipContract.Presets_AreScopedAndNamesAreUniquePerOwner(new MySqlTransformPresetStore(c)));
    [MySqlFact] public void Claim() => With(c => OwnershipContract.ClaimUnowned_HandsOverOnlyOwnerZeroRows(new MySqlSavedConfigStore(c), new MySqlOutputBlueprintStore(c), new MySqlTransformPresetStore(c)));
}

// ── The endpoints ────────────────────────────────────────────────────────────

public class AuthenticationEndpointTests : IDisposable
{
    private readonly List<string> _files = [];
    private readonly WebApplicationFactory<Program> _factory;
    private readonly string _aliceKey, _bobKey;

    public AuthenticationEndpointTests()
    {
        string Db(string name) { var p = Path.Combine(Path.GetTempPath(), $"sf-auth-{name}-{Guid.NewGuid():N}.db"); _files.Add(p); return p; }
        var settings = new Dictionary<string, string?>
        {
            [AuthOptions.EnabledKey] = "true",
            ["Companion:SavedConfigsDbPath"] = Db("configs"), ["Companion:OutputBlueprintsDbPath"] = Db("blueprints"),
            ["Companion:TransformPresetsDbPath"] = Db("presets"), ["Companion:UsersDbPath"] = Db("users"),
        };
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(settings)));
        var users = _factory.Services.GetRequiredService<IUserStore>();
        _aliceKey = users.Create("alice").Key;
        _bobKey = users.Create("bob").Key;
    }

    public void Dispose()
    {
        _factory.Dispose();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        foreach (var file in _files) if (File.Exists(file)) File.Delete(file);
    }

    private HttpClient Client(string? key)
    {
        var client = _factory.CreateClient();
        if (key is not null) client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", key);
        return client;
    }

    private static StringContent Json(string payload) => new(payload, Encoding.UTF8, "application/json");

    [Fact]
    public async Task WithoutAKey_EverythingExceptHealthIsRefused()
    {
        using var client = Client(null);

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);
        foreach (var path in new[] { "/configs", "/blueprints", "/transform-presets", "/whoami" })
        {
            var response = await client.GetAsync(path);
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            Assert.Contains("Bearer", response.Headers.WwwAuthenticate.ToString());
        }
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/generate", Json("{}"))).StatusCode);

        var body = await (await client.GetAsync("/configs")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("access key", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task AWrongKey_IsRefusedWithADifferentMessage()
    {
        using var client = Client("sf_definitely-not-a-key");
        var response = await client.GetAsync("/configs");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Contains("not valid", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
    }

    [Fact]
    public async Task HealthReportsThatAuthenticationIsRequired_AndWhoamiNamesTheUser()
    {
        using var anonymous = Client(null);
        Assert.True((await anonymous.GetFromJsonAsync<JsonElement>("/health")).GetProperty("authRequired").GetBoolean());

        using var alice = Client(_aliceKey);
        var whoami = await alice.GetFromJsonAsync<JsonElement>("/whoami");
        Assert.Equal("alice", whoami.GetProperty("name").GetString());
    }

    [Fact]
    public async Task ACorsPreflight_NeedsNoKey_AndAllowsTheAuthorizationHeader()
    {
        using var client = Client(null);
        var request = new HttpRequestMessage(HttpMethod.Options, "/configs");
        request.Headers.Add("Origin", "chrome-extension://abc");
        request.Headers.Add("Access-Control-Request-Method", "GET");
        request.Headers.Add("Access-Control-Request-Headers", "authorization");

        var response = await client.SendAsync(request);

        Assert.True(response.IsSuccessStatusCode, response.StatusCode.ToString());
        Assert.Contains("authorization", string.Join(",", response.Headers.GetValues("Access-Control-Allow-Headers")), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task TwoUsers_NeverSeeEachOthersConfigurationsOutputsBlueprintsOrPresets()
    {
        using var alice = Client(_aliceKey);
        using var bob = Client(_bobKey);

        var saved = await alice.PostAsync("/configs", Json("""{ "url": "https://example.com/a", "name": "alice's", "config": { "url": "https://example.com/a" } }"""));
        var configId = (await saved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();
        var output = await alice.PostAsync($"/configs/{configId}/outputs", Json("""{ "name": "run", "fileName": "o.csv", "content": "a\n1\n" }"""));
        var outputId = (await output.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();
        await alice.PostAsync("/blueprints", Json("""{ "name": "alice blueprint", "fieldNames": ["A"] }"""));
        await alice.PostAsync("/transform-presets", Json("""{ "name": "Clean", "transforms": [ { "kind": "trim" } ] }"""));

        // Bob sees nothing of it …
        Assert.Equal(0, (await bob.GetFromJsonAsync<JsonElement>("/configs")).GetArrayLength());
        Assert.Equal(0, (await bob.GetFromJsonAsync<JsonElement>("/configs?url=https://example.com/")).GetArrayLength());
        Assert.Equal(0, (await bob.GetFromJsonAsync<JsonElement>("/blueprints")).GetArrayLength());
        Assert.Equal(0, (await bob.GetFromJsonAsync<JsonElement>("/transform-presets")).GetArrayLength());
        // … cannot read, change or delete it by id …
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/configs/{configId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/configs/{configId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/configs/{configId}/outputs")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/configs/{configId}/outputs/{outputId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/configs/{configId}/outputs/{outputId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.PostAsync($"/configs/{configId}/outputs", Json("""{ "name": "x", "fileName": "o.csv", "content": "x" }"""))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.PostAsync($"/configs/{configId}/outputs/{outputId}/replay-hardening", Json("""{ "checks": [ { "kind": "noResult", "severity": "Warning" } ] }"""))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync("/blueprints/1")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync("/blueprints/1")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.PutAsync("/transform-presets/1", Json("""{ "name": "hijack" }"""))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync("/transform-presets/1")).StatusCode);

        // … and Alice still has everything, untouched.
        Assert.Equal(1, (await alice.GetFromJsonAsync<JsonElement>("/configs")).GetArrayLength());
        Assert.Equal(HttpStatusCode.OK, (await alice.GetAsync($"/configs/{configId}/outputs/{outputId}")).StatusCode);
        Assert.Equal(1, (await alice.GetFromJsonAsync<JsonElement>("/blueprints")).GetArrayLength());
        Assert.Equal(1, (await alice.GetFromJsonAsync<JsonElement>("/transform-presets")).GetArrayLength());

        // Bob may use the same preset name independently.
        Assert.Equal(HttpStatusCode.Created, (await bob.PostAsync("/transform-presets", Json("""{ "name": "Clean", "transforms": [ { "kind": "trim" } ] }"""))).StatusCode);
    }

    [Fact]
    public async Task AUserWhoseKeyWasRotated_LosesAccessWithTheOldKey()
    {
        var users = _factory.Services.GetRequiredService<IUserStore>();
        using var before = Client(_aliceKey);
        Assert.Equal(HttpStatusCode.OK, (await before.GetAsync("/configs")).StatusCode);

        var newKey = users.RotateKey("alice")!;

        Assert.Equal(HttpStatusCode.Unauthorized, (await before.GetAsync("/configs")).StatusCode);
        using var after = Client(newKey);
        Assert.Equal(HttpStatusCode.OK, (await after.GetAsync("/configs")).StatusCode);
    }
}

public class WithoutAuthenticationTests
{
    [Fact]
    public async Task TheDefault_NeedsNoKey_AndReportsIt()
    {
        var settings = new Dictionary<string, string?>
        {
            ["Companion:SavedConfigsDbPath"] = Path.Combine(Path.GetTempPath(), $"sf-noauth-{Guid.NewGuid():N}.db"),
        };
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(settings)));
        using var client = factory.CreateClient();

        Assert.False((await client.GetFromJsonAsync<JsonElement>("/health")).GetProperty("authRequired").GetBoolean());
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/configs")).StatusCode);
        var whoami = await client.GetFromJsonAsync<JsonElement>("/whoami");
        Assert.Equal("", whoami.GetProperty("name").GetString());
        Assert.False(whoami.GetProperty("authRequired").GetBoolean());
    }
}

// ── The `user` command line ──────────────────────────────────────────────────

public class UserCommandsTests : IDisposable
{
    private readonly List<string> _files = [];
    private readonly IConfiguration _configuration;

    public UserCommandsTests()
    {
        string Db(string name) { var p = Path.Combine(Path.GetTempPath(), $"sf-cli-{name}-{Guid.NewGuid():N}.db"); _files.Add(p); return p; }
        _configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Companion:SavedConfigsDbPath"] = Db("configs"), ["Companion:OutputBlueprintsDbPath"] = Db("blueprints"),
            ["Companion:TransformPresetsDbPath"] = Db("presets"), ["Companion:UsersDbPath"] = Db("users"),
        }).Build();
    }

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        foreach (var file in _files) if (File.Exists(file)) File.Delete(file);
    }

    private (int Code, string Out, string Err) Run(params string[] args)
    {
        var output = new StringWriter();
        var error = new StringWriter();
        var code = UserCommands.Run(["user", .. args], _configuration, output, error);
        return (code, output.ToString(), error.ToString());
    }

    [Fact]
    public void IsUserCommand_OnlyForTheUserVerb()
    {
        Assert.True(UserCommands.IsUserCommand(["user", "list"]));
        Assert.True(UserCommands.IsUserCommand(["USER"]));
        Assert.False(UserCommands.IsUserCommand([]));
        Assert.False(UserCommands.IsUserCommand(["--Companion:Port=5050"]));
    }

    [Fact]
    public void Add_PrintsTheKeyOnce_AndTheKeyWorks()
    {
        var (code, output, _) = Run("add", "alice");

        Assert.Equal(0, code);
        var key = output.Split('\n').Select(l => l.Trim()).Single(l => l.StartsWith(ApiKeys.Prefix));
        Assert.Equal("alice", StorageOptions.CreateUserStore(_configuration).FindByKey(key)!.Name);
        Assert.Contains("not switched on", output);   // auth is not enabled in this configuration
        Assert.DoesNotContain(key, Run("list").Out);
    }

    [Fact]
    public void Add_RejectsADuplicateAndAnInvalidName()
    {
        Run("add", "alice");

        var duplicate = Run("add", "Alice");
        Assert.Equal(1, duplicate.Code);
        Assert.Contains("already exists", duplicate.Err);

        var invalid = Run("add", "bad name!");
        Assert.Equal(2, invalid.Code);
        Assert.Contains("Invalid user name", invalid.Err);
    }

    [Fact]
    public void ListRotateRemove()
    {
        Assert.Contains("No users yet", Run("list").Out);
        Run("add", "alice");
        Assert.Contains("alice", Run("list").Out);

        var rotated = Run("rotate", "alice");
        Assert.Equal(0, rotated.Code);
        Assert.Contains(ApiKeys.Prefix, rotated.Out);
        Assert.Equal(1, Run("rotate", "nobody").Code);

        Assert.Equal(0, Run("remove", "alice").Code);
        Assert.Equal(1, Run("remove", "alice").Code);
        Assert.Contains("No users yet", Run("list").Out);
    }

    [Fact]
    public void Adopt_GivesTheUserTheDataSavedBeforeAuthentication()
    {
        var configs = StorageOptions.CreateSavedConfigStore(_configuration);
        configs.Save("https://example.com", "old", "{}");
        Run("add", "alice");

        var result = Run("adopt", "alice");

        Assert.Equal(0, result.Code);
        Assert.Contains("1 saved configuration", result.Out);
        var alice = StorageOptions.CreateUserStore(_configuration).FindByName("alice")!;
        Assert.Equal(["old"], configs.ListAll(ownerId: alice.Id).Select(c => c.Name));
        Assert.Empty(configs.ListAll());
        Assert.Equal(1, Run("adopt", "nobody").Code);
    }

    [Fact]
    public void MissingNameOrUnknownCommand_ShowsUsage()
    {
        Assert.Equal(2, Run("add").Code);
        Assert.Equal(2, Run("frobnicate").Code);
        Assert.Contains("Usage", Run().Out);
    }
}
