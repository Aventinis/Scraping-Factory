using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ScrapingFactory.Companion.Auth;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #352: self-service accounts — password hashing, the throttle, the
// store additions (password, disabled flag, per-device tokens; SQLite + MySQL),
// the /auth endpoints and the new `user` commands.

public class PasswordHasherTests
{
    [Fact]
    public void AHashVerifiesOnlyForTheSamePassword()
    {
        var hash = PasswordHasher.Hash("correct horse battery");
        Assert.True(PasswordHasher.Verify("correct horse battery", hash));
        Assert.False(PasswordHasher.Verify("correct horse batterx", hash));
        Assert.False(PasswordHasher.Verify("", hash));
    }

    [Fact]
    public void EveryHashHasItsOwnSalt_AndNeverContainsThePassword()
    {
        var first = PasswordHasher.Hash("same-password-1");
        var second = PasswordHasher.Hash("same-password-1");
        Assert.NotEqual(first, second);
        Assert.DoesNotContain("same-password-1", first);
        Assert.StartsWith($"pbkdf2-sha256${PasswordHasher.Iterations}$", first);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("garbage")]
    [InlineData("pbkdf2-sha256$600000$not-base64$also-not")]
    [InlineData("pbkdf2-sha256$x$AAAA$AAAA")]
    [InlineData("md5$1$AAAA$AAAA")]
    public void AMalformedStoredValue_NeverVerifies(string? stored) => Assert.False(PasswordHasher.Verify("whatever-password", stored));

    [Fact]
    public void AnOlderIterationCountStillVerifies()
    {
        // The count travels with the hash, so raising it later keeps old passwords valid.
        var salt = new byte[16];
        var hash = System.Security.Cryptography.Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes("legacy-password-1"), salt, 1000, System.Security.Cryptography.HashAlgorithmName.SHA256, 32);
        var stored = $"pbkdf2-sha256$1000${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
        Assert.True(PasswordHasher.Verify("legacy-password-1", stored));
    }

    [Theory]
    [InlineData("short", "alice", true)]
    [InlineData("a-long-enough-password", "alice", false)]
    [InlineData("alice-alice", "alice-alice", true)]
    [InlineData("ALICE-ALICE", "alice-alice", true)]
    public void PolicyRejectsShortPasswordsAndTheUserName(string password, string user, bool rejected) =>
        Assert.Equal(rejected, PasswordHasher.CheckPolicy(password, user) is not null);

    [Fact]
    public void PolicyRejectsAnAbsurdlyLongPassword() =>
        Assert.NotNull(PasswordHasher.CheckPolicy(new string('x', PasswordHasher.MaximumLength + 1), "alice"));
}

public class LoginThrottleTests
{
    private sealed class Clock { public DateTimeOffset Now = DateTimeOffset.Parse("2026-01-01T00:00:00Z"); }

    [Fact]
    public void FailuresLockOutOneUser_NotOthers_AndExpire()
    {
        var clock = new Clock();
        var throttle = new LoginThrottle(() => clock.Now) { MaxFailuresPerUser = 3, UserWindow = TimeSpan.FromMinutes(10) };

        for (var i = 0; i < 3; i++) throttle.RecordFailure("Alice");
        Assert.True(throttle.RetryAfterSeconds("1.1.1.1", "alice") > 0);        // names are case-insensitive
        Assert.Equal(0, throttle.RetryAfterSeconds("1.1.1.1", "bob"));

        clock.Now += TimeSpan.FromMinutes(11);
        Assert.Equal(0, throttle.RetryAfterSeconds("1.1.1.1", "alice"));
    }

    [Fact]
    public void ASuccessfulLoginClearsTheFailures()
    {
        var throttle = new LoginThrottle { MaxFailuresPerUser = 2 };
        throttle.RecordFailure("alice");
        throttle.RecordFailure("alice");
        Assert.True(throttle.RetryAfterSeconds("ip", "alice") > 0);
        throttle.ClearFailures("alice");
        Assert.Equal(0, throttle.RetryAfterSeconds("ip", "alice"));
    }

    [Fact]
    public void TooManyAttemptsFromOneAddress_AreRefused()
    {
        var throttle = new LoginThrottle { MaxAttemptsPerAddress = 4 };
        for (var i = 0; i < 4; i++) throttle.RecordAttempt("9.9.9.9");
        Assert.True(throttle.RetryAfterSeconds("9.9.9.9", null) > 0);
        Assert.Equal(0, throttle.RetryAfterSeconds("8.8.8.8", null));
    }
}

// ── Store contract: password, disabled flag, tokens ──────────────────────────

internal static class AccountStoreContract
{
    public static void PasswordUsers(IUserStore store)
    {
        var registered = store.CreateWithPassword("carol", "hash-1");
        Assert.True(registered.HasPassword);
        Assert.Equal("hash-1", store.GetPasswordHash("CAROL"));
        Assert.True(store.FindByName("carol")!.HasPassword);
        Assert.Throws<InvalidOperationException>(() => store.CreateWithPassword("Carol", "x"));

        var (keyOnly, _) = store.Create("dave");
        Assert.False(keyOnly.HasPassword);
        Assert.Null(store.GetPasswordHash("dave"));
        Assert.Null(store.GetPasswordHash("nobody"));

        Assert.True(store.SetPassword("dave", "hash-2"));
        Assert.Equal("hash-2", store.GetPasswordHash("dave"));
        Assert.True(store.FindByName("dave")!.HasPassword);
        Assert.False(store.SetPassword("nobody", "x"));
    }

    public static void Tokens(IUserStore store)
    {
        var user = store.CreateWithPassword("erin", "hash");
        var first = store.CreateToken(user.Id, "laptop");
        var second = store.CreateToken(user.Id, "phone");
        Assert.NotEqual(first, second);
        Assert.Equal("erin", store.FindByKey(first)!.Name);
        Assert.Equal("erin", store.FindByKey(second)!.Name);

        Assert.True(store.RevokeToken(first));
        Assert.False(store.RevokeToken(first));
        Assert.Null(store.FindByKey(first));
        Assert.NotNull(store.FindByKey(second));

        var third = store.CreateToken(user.Id, "tablet");
        Assert.Equal(1, store.RevokeTokens(user.Id, exceptToken: third));      // phone goes, tablet stays
        Assert.Null(store.FindByKey(second));
        Assert.NotNull(store.FindByKey(third));
        Assert.Equal(1, store.RevokeTokens(user.Id));
        Assert.Null(store.FindByKey(third));
    }

    public static void TokensOnlyStoreTheirHash_AndRemovingTheUserRemovesThem(IUserStore store)
    {
        var user = store.CreateWithPassword("frank", "hash");
        var token = store.CreateToken(user.Id, "x");
        Assert.NotNull(store.FindByKey(token));
        Assert.True(store.Remove("frank"));
        Assert.Null(store.FindByKey(token));
    }

    public static void DisabledUsers(IUserStore store)
    {
        var (grace, key) = store.Create("grace");
        var token = store.CreateToken(grace.Id, "x");
        Assert.True(store.SetDisabled("grace", true));
        Assert.True(store.FindByName("grace")!.Disabled);
        Assert.Null(store.FindByKey(key));
        Assert.Null(store.FindByKey(token));

        Assert.True(store.SetDisabled("grace", false));
        Assert.NotNull(store.FindByKey(key));
        Assert.NotNull(store.FindByKey(token));
        Assert.False(store.SetDisabled("nobody", true));
    }

    // A rotated key must not break the user's tokens, and a token must not
    // survive being revoked through a password change elsewhere.
    public static void RotatingTheKeyLeavesTokensAlone(IUserStore store)
    {
        var user = store.CreateWithPassword("heidi", "hash");
        var token = store.CreateToken(user.Id, "x");
        store.RotateKey("heidi");
        Assert.NotNull(store.FindByKey(token));
    }
}

public class SqliteAccountStoreTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"sf-acct-{Guid.NewGuid():N}.db");
    private IUserStore Store() => new SqliteUserStore(_path);

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (File.Exists(_path)) File.Delete(_path);
    }

    [Fact] public void PasswordUsers() => AccountStoreContract.PasswordUsers(Store());
    [Fact] public void Tokens() => AccountStoreContract.Tokens(Store());
    [Fact] public void RemovingAUserRemovesTheirTokens() => AccountStoreContract.TokensOnlyStoreTheirHash_AndRemovingTheUserRemovesThem(Store());
    [Fact] public void Disabled() => AccountStoreContract.DisabledUsers(Store());
    [Fact] public void RotatingTheKey() => AccountStoreContract.RotatingTheKeyLeavesTokensAlone(Store());

    [Fact]
    public void TokensAreStoredOnlyAsHashes()
    {
        var store = Store();
        var user = store.CreateWithPassword("ivan", "hash");
        var token = store.CreateToken(user.Id, "x");
        using var connection = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={_path}");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT group_concat(TokenHash) FROM Tokens;";
        var stored = (string)command.ExecuteScalar()!;
        Assert.DoesNotContain(token, stored);
        Assert.Contains(ApiKeys.Hash(token), stored);
    }

    // A users.db from before accounts existed keeps working (idempotent migration).
    [Fact]
    public void AnOlderUsersDatabase_GainsTheNewColumns()
    {
        using (var connection = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={_path}"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = """
                CREATE TABLE Users (Id INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT NOT NULL UNIQUE COLLATE NOCASE, KeyHash TEXT NOT NULL UNIQUE, CreatedAt TEXT NOT NULL);
                INSERT INTO Users (Name, KeyHash, CreatedAt) VALUES ('old', 'abc', '2025-01-01');
                """;
            command.ExecuteNonQuery();
        }

        var store = Store();
        var old = store.FindByName("old")!;
        Assert.False(old.HasPassword);
        Assert.False(old.Disabled);
        Assert.True(store.SetPassword("old", "hash"));
        _ = new SqliteUserStore(_path); // opening again must not fail either
    }
}

public class MySqlAccountStoreTests
{
    private static void With(Action<IUserStore> test)
    {
        using var database = new MySqlTestDatabase();
        test(new MySqlUserStore(database.ConnectionString));
    }

    [MySqlFact] public void PasswordUsers() => With(AccountStoreContract.PasswordUsers);
    [MySqlFact] public void Tokens() => With(AccountStoreContract.Tokens);
    [MySqlFact] public void RemovingAUserRemovesTheirTokens() => With(AccountStoreContract.TokensOnlyStoreTheirHash_AndRemovingTheUserRemovesThem);
    [MySqlFact] public void Disabled() => With(AccountStoreContract.DisabledUsers);
    [MySqlFact] public void RotatingTheKey() => With(AccountStoreContract.RotatingTheKeyLeavesTokensAlone);
}

// ── The endpoints ────────────────────────────────────────────────────────────

public class AccountEndpointTests : IDisposable
{
    private readonly List<string> _files = [];
    private WebApplicationFactory<Program>? _factory;

    private WebApplicationFactory<Program> Factory(bool registration = true, Dictionary<string, string?>? extra = null)
    {
        string Db(string name) { var p = Path.Combine(Path.GetTempPath(), $"sf-acct-ep-{name}-{Guid.NewGuid():N}.db"); _files.Add(p); return p; }
        var settings = new Dictionary<string, string?>
        {
            [AuthOptions.EnabledKey] = "true",
            [AuthOptions.RegistrationKey] = registration ? "Open" : "Disabled",
            ["Companion:SavedConfigsDbPath"] = Db("configs"), ["Companion:OutputBlueprintsDbPath"] = Db("blueprints"),
            ["Companion:TransformPresetsDbPath"] = Db("presets"), ["Companion:UsersDbPath"] = Db("users"),
        };
        foreach (var (key, value) in extra ?? []) settings[key] = value;
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(settings)));
        return _factory;
    }

    public void Dispose()
    {
        _factory?.Dispose();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        foreach (var file in _files) if (File.Exists(file)) File.Delete(file);
    }

    private static StringContent Json(object payload) => new(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

    private static async Task<(HttpStatusCode Status, JsonElement Body)> PostAsync(HttpClient client, string path, object payload)
    {
        var response = await client.PostAsync(path, Json(payload));
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, text.Length == 0 ? default : JsonDocument.Parse(text).RootElement);
    }

    private static HttpClient WithToken(HttpClient client, string token)
    {
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private const string Password = "a-sufficiently-long-password";

    [Fact]
    public async Task HealthReportsWhetherRegistrationIsOpen()
    {
        using var open = Factory(registration: true).CreateClient();
        Assert.True((await open.GetFromJsonAsync<JsonElement>("/health")).GetProperty("registration").GetBoolean());
        _factory!.Dispose();
        using var closed = Factory(registration: false).CreateClient();
        Assert.False((await closed.GetFromJsonAsync<JsonElement>("/health")).GetProperty("registration").GetBoolean());
    }

    [Fact]
    public async Task Registration_IsRefusedUnlessTheOperatorOpenedIt()
    {
        using var client = Factory(registration: false).CreateClient();
        var (status, body) = await PostAsync(client, "/auth/register", new { name = "alice", password = Password });
        Assert.Equal(HttpStatusCode.Forbidden, status);
        Assert.Contains("not enabled", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Register_CreatesTheUser_AndTheTokenWorks()
    {
        using var anonymous = Factory().CreateClient();
        var (status, body) = await PostAsync(anonymous, "/auth/register", new { name = "alice", password = Password });

        Assert.Equal(HttpStatusCode.Created, status);
        Assert.Equal("alice", body.GetProperty("name").GetString());
        var token = body.GetProperty("token").GetString()!;
        Assert.StartsWith(ApiKeys.Prefix, token);

        using var signedIn = WithToken(_factory!.CreateClient(), token);
        Assert.Equal("alice", (await signedIn.GetFromJsonAsync<JsonElement>("/whoami")).GetProperty("name").GetString());
    }

    [Fact]
    public async Task Register_ValidatesNameAndPassword_AndRejectsADuplicate()
    {
        using var client = Factory().CreateClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await PostAsync(client, "/auth/register", new { name = "bad name!", password = Password })).Status);
        Assert.Equal(HttpStatusCode.BadRequest, (await PostAsync(client, "/auth/register", new { name = "alice", password = "short" })).Status);
        Assert.Equal(HttpStatusCode.BadRequest, (await PostAsync(client, "/auth/register", new { name = "alice-alice", password = "alice-alice" })).Status);
        Assert.Equal(HttpStatusCode.Created, (await PostAsync(client, "/auth/register", new { name = "alice", password = Password })).Status);
        var (status, _) = await PostAsync(client, "/auth/register", new { name = "ALICE", password = Password });
        Assert.Equal(HttpStatusCode.Conflict, status);
    }

    [Fact]
    public async Task Login_ReturnsAFreshTokenPerDevice()
    {
        using var client = Factory().CreateClient();
        await PostAsync(client, "/auth/register", new { name = "alice", password = Password });

        var (status, first) = await PostAsync(client, "/auth/login", new { name = "alice", password = Password });
        var (_, second) = await PostAsync(client, "/auth/login", new { name = "ALICE", password = Password });

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.NotEqual(first.GetProperty("token").GetString(), second.GetProperty("token").GetString());
        using var device = WithToken(_factory!.CreateClient(), first.GetProperty("token").GetString()!);
        Assert.Equal(HttpStatusCode.OK, (await device.GetAsync("/whoami")).StatusCode);
    }

    // No user enumeration: the same status and message for an unknown name, a
    // wrong password, a user without a password and a disabled user.
    [Fact]
    public async Task LoginFailures_LookIdentical()
    {
        using var client = Factory().CreateClient();
        await PostAsync(client, "/auth/register", new { name = "alice", password = Password });
        var users = _factory!.Services.GetRequiredService<IUserStore>();
        users.Create("keyonly");
        await PostAsync(client, "/auth/register", new { name = "dis", password = Password });
        users.SetDisabled("dis", true);

        var attempts = new object[]
        {
            new { name = "alice", password = "wrong-password-123" },
            new { name = "nobody", password = Password },
            new { name = "keyonly", password = Password },
            new { name = "dis", password = Password },
            new { name = "", password = "" },
        };
        foreach (var attempt in attempts)
        {
            var (status, body) = await PostAsync(client, "/auth/login", attempt);
            Assert.Equal(HttpStatusCode.Unauthorized, status);
            Assert.Equal("Invalid user name or password.", body.GetProperty("error").GetString());
        }
    }

    [Fact]
    public async Task RepeatedWrongPasswords_LockTheNameOutTemporarily()
    {
        using var client = Factory().CreateClient();
        await PostAsync(client, "/auth/register", new { name = "alice", password = Password });

        for (var i = 0; i < 5; i++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(client, "/auth/login", new { name = "alice", password = "wrong-password-1" })).Status);

        var locked = await client.PostAsync("/auth/login", Json(new { name = "alice", password = Password }));
        Assert.Equal(HttpStatusCode.TooManyRequests, locked.StatusCode);
        Assert.True(locked.Headers.RetryAfter!.Delta!.Value.TotalSeconds > 0);
        // another name is unaffected
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(client, "/auth/login", new { name = "bob", password = Password })).Status);
    }

    [Fact]
    public async Task Logout_RevokesOnlyThisDevicesToken()
    {
        using var client = Factory().CreateClient();
        await PostAsync(client, "/auth/register", new { name = "alice", password = Password });
        var laptop = (await PostAsync(client, "/auth/login", new { name = "alice", password = Password })).Body.GetProperty("token").GetString()!;
        var phone = (await PostAsync(client, "/auth/login", new { name = "alice", password = Password })).Body.GetProperty("token").GetString()!;

        using var laptopClient = WithToken(_factory!.CreateClient(), laptop);
        Assert.Equal(HttpStatusCode.NoContent, (await laptopClient.PostAsync("/auth/logout", null)).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await laptopClient.GetAsync("/whoami")).StatusCode);
        using var phoneClient = WithToken(_factory.CreateClient(), phone);
        Assert.Equal(HttpStatusCode.OK, (await phoneClient.GetAsync("/whoami")).StatusCode);
    }

    [Fact]
    public async Task LogoutAll_SignsEveryDeviceOut()
    {
        using var client = Factory().CreateClient();
        await PostAsync(client, "/auth/register", new { name = "alice", password = Password });
        var a = (await PostAsync(client, "/auth/login", new { name = "alice", password = Password })).Body.GetProperty("token").GetString()!;
        var b = (await PostAsync(client, "/auth/login", new { name = "alice", password = Password })).Body.GetProperty("token").GetString()!;

        using var first = WithToken(_factory!.CreateClient(), a);
        Assert.Equal(HttpStatusCode.NoContent, (await first.PostAsync("/auth/logout-all", null)).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await first.GetAsync("/whoami")).StatusCode);
        using var second = WithToken(_factory.CreateClient(), b);
        Assert.Equal(HttpStatusCode.Unauthorized, (await second.GetAsync("/whoami")).StatusCode);
    }

    [Fact]
    public async Task ChangePassword_NeedsTheCurrentOne_AndSignsOtherDevicesOut()
    {
        using var client = Factory().CreateClient();
        await PostAsync(client, "/auth/register", new { name = "alice", password = Password });
        var mine = (await PostAsync(client, "/auth/login", new { name = "alice", password = Password })).Body.GetProperty("token").GetString()!;
        var other = (await PostAsync(client, "/auth/login", new { name = "alice", password = Password })).Body.GetProperty("token").GetString()!;
        using var me = WithToken(_factory!.CreateClient(), mine);

        var wrong = await PostAsync(me, "/auth/change-password", new { currentPassword = "not-my-password-1", newPassword = "another-long-password" });
        Assert.Equal(HttpStatusCode.Unauthorized, wrong.Status);
        var weak = await PostAsync(me, "/auth/change-password", new { currentPassword = Password, newPassword = "short" });
        Assert.Equal(HttpStatusCode.BadRequest, weak.Status);

        var ok = await me.PostAsync("/auth/change-password", Json(new { currentPassword = Password, newPassword = "another-long-password" }));
        Assert.Equal(HttpStatusCode.NoContent, ok.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await me.GetAsync("/whoami")).StatusCode);                       // this device stays signed in
        using var otherDevice = WithToken(_factory.CreateClient(), other);
        Assert.Equal(HttpStatusCode.Unauthorized, (await otherDevice.GetAsync("/whoami")).StatusCode);    // the other does not
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(client, "/auth/login", new { name = "alice", password = Password })).Status);
        Assert.Equal(HttpStatusCode.OK, (await PostAsync(client, "/auth/login", new { name = "alice", password = "another-long-password" })).Status);
    }

    [Fact]
    public async Task AUserWithOnlyAKey_MaySetAFirstPasswordWithoutACurrentOne()
    {
        using var anonymous = Factory().CreateClient();
        var key = _factory!.Services.GetRequiredService<IUserStore>().Create("keyuser").Key;
        using var client = WithToken(_factory.CreateClient(), key);

        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/auth/change-password", Json(new { newPassword = Password }))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await PostAsync(anonymous, "/auth/login", new { name = "keyuser", password = Password })).Status);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/whoami")).StatusCode);                     // the key still works
    }

    [Fact]
    public async Task ADisabledUser_IsTurnedAwayEverywhere()
    {
        using var client = Factory().CreateClient();
        var token = (await PostAsync(client, "/auth/register", new { name = "alice", password = Password })).Body.GetProperty("token").GetString()!;
        _factory!.Services.GetRequiredService<IUserStore>().SetDisabled("alice", true);

        using var device = WithToken(_factory.CreateClient(), token);
        Assert.Equal(HttpStatusCode.Unauthorized, (await device.GetAsync("/whoami")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(client, "/auth/login", new { name = "alice", password = Password })).Status);
    }

    [Fact]
    public async Task RegisteredUsersGetTheirOwnData_NotEachOthers()
    {
        using var client = Factory().CreateClient();
        var alice = (await PostAsync(client, "/auth/register", new { name = "alice", password = Password })).Body.GetProperty("token").GetString()!;
        var bob = (await PostAsync(client, "/auth/register", new { name = "bob", password = Password })).Body.GetProperty("token").GetString()!;

        using var aliceClient = WithToken(_factory!.CreateClient(), alice);
        var saved = await PostAsync(aliceClient, "/configs", new { url = "https://example.com", name = "mine", config = new { url = "https://example.com" } });
        Assert.Equal(HttpStatusCode.Created, saved.Status);

        using var bobClient = WithToken(_factory.CreateClient(), bob);
        Assert.Empty((await bobClient.GetFromJsonAsync<JsonElement>("/configs")).EnumerateArray());
        Assert.Single((await aliceClient.GetFromJsonAsync<JsonElement>("/configs")).EnumerateArray());
    }

    [Fact]
    public async Task TheAuthEndpointsThatNeedASession_RefuseAnonymousCallers()
    {
        using var client = Factory().CreateClient();
        foreach (var path in new[] { "/auth/logout", "/auth/logout-all", "/auth/change-password" })
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync(path, Json(new { }))).StatusCode);
    }

    [Fact]
    public async Task WithoutAuthentication_ThereAreNoAuthEndpoints()
    {
        string Db(string n) => Path.Combine(Path.GetTempPath(), $"sf-acct-off-{n}-{Guid.NewGuid():N}.db");
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Companion:UsersDbPath"] = Db("u"), ["Companion:SavedConfigsDbPath"] = Db("c"),
            })));
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync("/auth/login", Json(new { name = "a", password = "b" }))).StatusCode);
        Assert.False((await client.GetFromJsonAsync<JsonElement>("/health")).GetProperty("registration").GetBoolean());
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
    }
}

public class AuthOptionsTests
{
    private static IConfiguration Config(params (string Key, string? Value)[] values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values.ToDictionary(v => v.Key, v => v.Value)).Build();

    [Fact]
    public void RegistrationIsOffByDefault_AndNeedsAuthentication()
    {
        Assert.False(AuthOptions.IsRegistrationOpen(Config()));
        Assert.False(AuthOptions.IsRegistrationOpen(Config((AuthOptions.RegistrationKey, "Open"))));
        Assert.True(AuthOptions.IsRegistrationOpen(Config((AuthOptions.EnabledKey, "true"), (AuthOptions.RegistrationKey, "open"))));
    }

    [Fact]
    public void Validate_RejectsUnknownValuesAndOpenWithoutAuthentication()
    {
        Assert.Null(AuthOptions.Validate(Config()));
        Assert.Null(AuthOptions.Validate(Config((AuthOptions.EnabledKey, "true"), (AuthOptions.RegistrationKey, "Open"))));
        Assert.Contains("Unknown", AuthOptions.Validate(Config((AuthOptions.RegistrationKey, "Maybe")))!);
        Assert.Contains("needs authentication", AuthOptions.Validate(Config((AuthOptions.RegistrationKey, "Open")))!);
    }
}

public class AccountCommandsTests : IDisposable
{
    private readonly List<string> _files = [];
    private readonly IConfiguration _configuration;

    public AccountCommandsTests()
    {
        string Db(string name) { var p = Path.Combine(Path.GetTempPath(), $"sf-acct-cli-{name}-{Guid.NewGuid():N}.db"); _files.Add(p); return p; }
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

    private (int Code, string Out, string Err) Run(string? stdin, params string[] args)
    {
        var output = new StringWriter();
        var error = new StringWriter();
        var code = UserCommands.Run(["user", .. args], _configuration, output, error, stdin is null ? null : new StringReader(stdin));
        return (code, output.ToString(), error.ToString());
    }

    [Fact]
    public void SetPassword_StoresAHash_AndSignsDevicesOut()
    {
        Run(null, "add", "alice");
        var users = new SqliteUserStore(SqliteUserStore.ResolveDbPath(_configuration));
        var alice = users.FindByName("alice")!;
        var token = users.CreateToken(alice.Id, "x");

        var (code, output, _) = Run("a-sufficiently-long-password\n", "set-password", "alice");

        Assert.Equal(0, code);
        Assert.Contains("1 signed-in device", output);
        Assert.True(PasswordHasher.Verify("a-sufficiently-long-password", users.GetPasswordHash("alice")));
        Assert.Null(users.FindByKey(token));
        Assert.DoesNotContain("a-sufficiently-long-password", output);
    }

    [Fact]
    public void SetPassword_AppliesThePolicy_AndNeedsAnExistingUser()
    {
        Run(null, "add", "alice");
        Assert.Equal(2, Run("short\n", "set-password", "alice").Code);
        var (code, _, error) = Run("a-sufficiently-long-password\n", "set-password", "nobody");
        Assert.Equal(1, code);
        Assert.Contains("No user named", error);
    }

    [Fact]
    public void DisableAndEnable_SwitchAUserOffAndOn_AndListShowsIt()
    {
        var key = Run(null, "add", "alice").Out.Split('\n').First(l => l.Contains("sf_")).Trim();
        var users = new SqliteUserStore(SqliteUserStore.ResolveDbPath(_configuration));

        Assert.Equal(0, Run(null, "disable", "alice").Code);
        Assert.Null(users.FindByKey(key));
        Assert.Contains("[disabled]", Run(null, "list").Out);

        Assert.Equal(0, Run(null, "enable", "alice").Code);
        Assert.NotNull(users.FindByKey(key));
        Assert.DoesNotContain("[disabled]", Run(null, "list").Out);
        Assert.Equal(1, Run(null, "disable", "nobody").Code);
    }

    [Fact]
    public void List_MarksUsersWithAPassword()
    {
        Run(null, "add", "alice");
        Run("a-sufficiently-long-password\n", "set-password", "alice");
        Assert.Contains("[password]", Run(null, "list").Out);
    }
}
