using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ScrapingFactory.Companion.Auth;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #353: email addresses, verification and password reset — the code and
// option helpers, the store additions (SQLite + MySQL), the mail sender (against
// a tiny SMTP server), the endpoints with a fake mailer, the operator rules and
// the `user` commands.

public class EmailCodeTests
{
    [Fact]
    public void ACodeIsEightDigits_KeepingLeadingZeros()
    {
        for (var i = 0; i < 200; i++)
            Assert.Matches(@"^\d{8}$", EmailCodes.Generate());
    }

    [Theory]
    [InlineData("12345678", "12345678")]
    [InlineData(" 1234 5678 ", "12345678")]
    [InlineData("1234-5678", "12345678")]
    [InlineData("0000 0001", "00000001")]
    [InlineData("1234567", null)]
    [InlineData("123456789", null)]
    [InlineData("1234abcd", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void WhatAPersonTypesIsNormalized(string? typed, string? expected) => Assert.Equal(expected, EmailCodes.Normalize(typed));

    [Fact]
    public void TheHashIsBoundToUserAndPurpose()
    {
        var verify = EmailCodes.Hash(1, EmailCodePurpose.Verify, "12345678");
        Assert.NotEqual(verify, EmailCodes.Hash(1, EmailCodePurpose.Reset, "12345678"));
        Assert.NotEqual(verify, EmailCodes.Hash(2, EmailCodePurpose.Verify, "12345678"));
        Assert.DoesNotContain("12345678", verify);
    }

    [Fact]
    public void EvaluationOrder_ExpiredThenTooManyThenCompare()
    {
        var now = DateTimeOffset.UtcNow;
        Assert.Equal(EmailCodeResult.Valid, EmailCodeEvaluation.Evaluate("aa", now.AddMinutes(1), 1, "aa", now, 5));
        Assert.Equal(EmailCodeResult.Wrong, EmailCodeEvaluation.Evaluate("aa", now.AddMinutes(1), 5, "bb", now, 5));
        Assert.Equal(EmailCodeResult.TooManyAttempts, EmailCodeEvaluation.Evaluate("aa", now.AddMinutes(1), 6, "aa", now, 5));
        Assert.Equal(EmailCodeResult.Expired, EmailCodeEvaluation.Evaluate("aa", now.AddMinutes(-1), 1, "aa", now, 5));
    }
}

public class EmailOptionsTests
{
    private static IConfiguration Config(Dictionary<string, string?> values) => new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    [Theory]
    [InlineData("Alice@Example.COM", "alice@example.com")]
    [InlineData("  bob@example.org ", "bob@example.org")]
    [InlineData("a.b+tag@sub.example.com", "a.b+tag@sub.example.com")]
    [InlineData("no-at-sign", null)]
    [InlineData("two@@example.com", null)]
    [InlineData("a@b@example.com", null)]
    [InlineData("name@localhost", null)]
    [InlineData("name@example.com.", null)]
    [InlineData("Alice <alice@example.com>", null)]
    [InlineData("a b@example.com", null)]
    [InlineData("a@example.com\r\nBcc: x@example.com", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void Normalize(string? raw, string? expected) => Assert.Equal(expected, EmailOptions.Normalize(raw));

    [Fact]
    public void NothingConfigured_MeansEverythingIsOff()
    {
        var policy = EmailOptions.Read(Config([]));
        Assert.Equal("off", policy.Mode);
        Assert.False(policy.SmtpConfigured);
        Assert.False(policy.AcceptsEmail);
        Assert.Null(EmailOptions.ReadSmtp(Config([])));
        Assert.Null(EmailOptions.Validate(Config([])));
    }

    [Fact]
    public void ModesFollowSmtpAndTheRequiredRule()
    {
        Assert.Equal("optional", EmailOptions.Read(Config(new() { [EmailOptions.SmtpHostKey] = "smtp.example.com" })).Mode);
        Assert.Equal("required", EmailOptions.Read(Config(new() { [EmailOptions.RequiredKey] = "true" })).Mode);
    }

    [Fact]
    public void SmtpSettingsHaveSensibleDefaults()
    {
        var smtp = EmailOptions.ReadSmtp(Config(new()
        {
            [EmailOptions.SmtpHostKey] = "smtp.example.com", ["Companion:Email:Smtp:From"] = "noreply@example.com",
        }))!;
        Assert.Equal((587, SmtpSecurity.StartTls), (smtp.Port, smtp.Security));
        var implicitTls = EmailOptions.ReadSmtp(Config(new()
        {
            [EmailOptions.SmtpHostKey] = "smtp.example.com", ["Companion:Email:Smtp:Security"] = "SslOnConnect",
        }))!;
        Assert.Equal(465, implicitTls.Port);
    }

    [Fact]
    public void AllowedDomains_AcceptACommaListOrAnArray()
    {
        Assert.Equal(["example.com", "example.org"], EmailOptions.Read(Config(new() { [EmailOptions.AllowedDomainsKey] = "Example.com, @example.org" })).AllowedDomains);
        Assert.Equal(["a.com", "b.com"], EmailOptions.Read(Config(new() { [EmailOptions.AllowedDomainsKey + ":0"] = "a.com", [EmailOptions.AllowedDomainsKey + ":1"] = "B.com" })).AllowedDomains);
    }

    [Fact]
    public void DomainAllowed_IsAnExactMatch_NotASuffixMatch()
    {
        var policy = new EmailPolicy(true, false, false, ["example.com"]);
        Assert.True(EmailOptions.DomainAllowed(policy, "a@example.com"));
        Assert.False(EmailOptions.DomainAllowed(policy, "a@mail.example.com"));
        Assert.False(EmailOptions.DomainAllowed(policy, "a@evilexample.com"));
        Assert.True(EmailOptions.DomainAllowed(new EmailPolicy(true, false, false, []), "a@anything.org"));
    }

    private static Dictionary<string, string?> Smtp(params (string Key, string Value)[] extra)
    {
        var values = new Dictionary<string, string?> { [EmailOptions.SmtpHostKey] = "smtp.example.com", ["Companion:Email:Smtp:From"] = "noreply@example.com" };
        foreach (var (key, value) in extra) values[key] = value;
        return values;
    }

    [Fact]
    public void Validate_RefusesUnsafeOrIncompleteSetups()
    {
        var auth = (AuthOptions.EnabledKey, "true");
        Assert.Contains("From", EmailOptions.Validate(Config(new() { [EmailOptions.SmtpHostKey] = "smtp.example.com" })));
        Assert.Contains("Security", EmailOptions.Validate(Config(Smtp(("Companion:Email:Smtp:Security", "Tls13")))));
        Assert.Contains("Port", EmailOptions.Validate(Config(Smtp(("Companion:Email:Smtp:Port", "99999")))));
        Assert.Contains("without TLS", EmailOptions.Validate(Config(Smtp(("Companion:Email:Smtp:Security", "None"))), developmentBuild: false));
        Assert.Contains("true or false", EmailOptions.Validate(Config(Smtp(auth, (EmailOptions.RequiredKey, "sometimes")))));
        Assert.Contains("need authentication", EmailOptions.Validate(Config(Smtp((EmailOptions.RequiredKey, "true")))));
        Assert.Contains("needs an SMTP server", EmailOptions.Validate(Config(new() { [AuthOptions.EnabledKey] = "true", [EmailOptions.RequireVerifiedKey] = "true" })));
        Assert.Contains("domains", EmailOptions.Validate(Config(new() { [AuthOptions.EnabledKey] = "true", [EmailOptions.AllowedDomainsKey] = "nodot" })));
    }

    [Fact]
    public void Validate_AllowsLoopbackWithoutTls_AndDevelopmentBuilds()
    {
        Assert.Null(EmailOptions.Validate(Config(Smtp(("Companion:Email:Smtp:Host", "127.0.0.1"), ("Companion:Email:Smtp:Security", "None"))), developmentBuild: false));
        Assert.Null(EmailOptions.Validate(Config(Smtp(("Companion:Email:Smtp:Security", "None"))), developmentBuild: true));
        Assert.Null(EmailOptions.Validate(Config(Smtp((AuthOptions.EnabledKey, "true"), (EmailOptions.RequireVerifiedKey, "true"), (EmailOptions.RequiredKey, "true")))));
    }
}

// ── Store contract: email address and one-time codes ─────────────────────────

internal static class EmailStoreContract
{
    public static void EmailAddresses(IUserStore store)
    {
        var with = store.CreateWithPassword("alice", "hash", "alice@example.com");
        Assert.Equal("alice@example.com", with.Email);
        Assert.False(with.EmailVerified);
        Assert.Equal("alice", store.FindByEmail("ALICE@Example.com")!.Name);          // case-insensitive
        Assert.Null(store.FindByEmail("nobody@example.com"));
        Assert.Throws<EmailInUseException>(() => store.CreateWithPassword("bob", "hash", "Alice@example.com"));
        Assert.Null(store.FindByName("bob"));

        // Accounts without an address never collide with each other.
        var (carol, _) = store.Create("carol");
        var (dave, _) = store.Create("dave");
        Assert.Null(carol.Email);
        Assert.Null(dave.Email);

        Assert.True(store.SetEmail(carol.Id, "carol@example.com", verified: false));
        Assert.Throws<EmailInUseException>(() => store.SetEmail(dave.Id, "carol@example.com", false));
        Assert.False(store.SetEmail(9999, "x@example.com", false));
        Assert.Equal("carol@example.com", store.FindByName("carol")!.Email);

        Assert.True(store.SetEmailVerified(carol.Id, true));
        Assert.True(store.FindByName("carol")!.EmailVerified);
        Assert.False(store.SetEmailVerified(dave.Id, true));                      // no address, nothing to verify

        // A new address is unverified again unless the operator says otherwise.
        Assert.True(store.SetEmail(carol.Id, "carol2@example.com", verified: false));
        Assert.False(store.FindByName("carol")!.EmailVerified);
        Assert.True(store.SetEmail(carol.Id, "carol3@example.com", verified: true));
        Assert.True(store.FindByName("carol")!.EmailVerified);
        Assert.Null(store.FindByEmail("carol@example.com"));                      // the old one is free again
        Assert.True(store.SetEmail(carol.Id, null, verified: true));
        Assert.Null(store.FindByName("carol")!.Email);
        Assert.False(store.FindByName("carol")!.EmailVerified);

        // The list and the key lookup carry the address too.
        Assert.Equal("alice@example.com", store.List().Single(u => u.Name == "alice").Email);
        var token = store.CreateToken(with.Id, "x");
        Assert.Equal("alice@example.com", store.FindByKey(token)!.Email);
    }

    public static void Codes(IUserStore store)
    {
        var user = store.CreateWithPassword("erin", "hash", "erin@example.com");
        var now = DateTimeOffset.UtcNow;
        string H(string code) => EmailCodes.Hash(user.Id, EmailCodePurpose.Verify, code);

        // No code yet.
        Assert.Equal(EmailCodeResult.Expired, store.CheckEmailCode(user.Id, EmailCodePurpose.Verify, H("11111111"), now, 5));
        Assert.Null(store.EmailCodeSentAt(user.Id, EmailCodePurpose.Verify));

        // A wrong guess keeps the code, the right one consumes it.
        store.SaveEmailCode(user.Id, EmailCodePurpose.Verify, H("11111111"), now.AddHours(1));
        Assert.NotNull(store.EmailCodeSentAt(user.Id, EmailCodePurpose.Verify));
        Assert.Equal(EmailCodeResult.Wrong, store.CheckEmailCode(user.Id, EmailCodePurpose.Verify, H("22222222"), now, 5));
        Assert.Equal(EmailCodeResult.Valid, store.CheckEmailCode(user.Id, EmailCodePurpose.Verify, H("11111111"), now, 5));
        Assert.Equal(EmailCodeResult.Expired, store.CheckEmailCode(user.Id, EmailCodePurpose.Verify, H("11111111"), now, 5)); // single use

        // Five wrong guesses are allowed; the sixth is refused even when it is right, and the code is gone.
        store.SaveEmailCode(user.Id, EmailCodePurpose.Verify, H("33333333"), now.AddHours(1));
        for (var i = 0; i < 5; i++)
            Assert.Equal(EmailCodeResult.Wrong, store.CheckEmailCode(user.Id, EmailCodePurpose.Verify, H("00000000"), now, 5));
        Assert.Equal(EmailCodeResult.TooManyAttempts, store.CheckEmailCode(user.Id, EmailCodePurpose.Verify, H("33333333"), now, 5));
        Assert.Equal(EmailCodeResult.Expired, store.CheckEmailCode(user.Id, EmailCodePurpose.Verify, H("33333333"), now, 5));

        // An expired code is refused and removed.
        store.SaveEmailCode(user.Id, EmailCodePurpose.Verify, H("44444444"), now.AddMinutes(-1));
        Assert.Equal(EmailCodeResult.Expired, store.CheckEmailCode(user.Id, EmailCodePurpose.Verify, H("44444444"), now, 5));
        Assert.Null(store.EmailCodeSentAt(user.Id, EmailCodePurpose.Verify));

        // A new code replaces the old one and starts counting from zero again.
        store.SaveEmailCode(user.Id, EmailCodePurpose.Verify, H("55555555"), now.AddHours(1));
        store.CheckEmailCode(user.Id, EmailCodePurpose.Verify, H("00000000"), now, 5);
        store.SaveEmailCode(user.Id, EmailCodePurpose.Verify, H("66666666"), now.AddHours(1));
        Assert.Equal(EmailCodeResult.Wrong, store.CheckEmailCode(user.Id, EmailCodePurpose.Verify, H("55555555"), now, 5));
        Assert.Equal(EmailCodeResult.Valid, store.CheckEmailCode(user.Id, EmailCodePurpose.Verify, H("66666666"), now, 5));
    }

    public static void CodesArePerPurpose_AndDeletable(IUserStore store)
    {
        var user = store.CreateWithPassword("frank", "hash", "frank@example.com");
        var now = DateTimeOffset.UtcNow;
        store.SaveEmailCode(user.Id, EmailCodePurpose.Verify, "v", now.AddHours(1));
        store.SaveEmailCode(user.Id, EmailCodePurpose.Reset, "r", now.AddHours(1));
        Assert.Equal(EmailCodeResult.Valid, store.CheckEmailCode(user.Id, EmailCodePurpose.Reset, "r", now, 5));
        Assert.NotNull(store.EmailCodeSentAt(user.Id, EmailCodePurpose.Verify));          // the other purpose is untouched

        store.SaveEmailCode(user.Id, EmailCodePurpose.Reset, "r2", now.AddHours(1));
        store.DeleteEmailCodes(user.Id, EmailCodePurpose.Verify);
        Assert.Null(store.EmailCodeSentAt(user.Id, EmailCodePurpose.Verify));
        Assert.NotNull(store.EmailCodeSentAt(user.Id, EmailCodePurpose.Reset));
        store.DeleteEmailCodes(user.Id);
        Assert.Null(store.EmailCodeSentAt(user.Id, EmailCodePurpose.Reset));
    }

    public static void ChangingTheAddressDropsPendingVerificationCodes(IUserStore store)
    {
        var user = store.CreateWithPassword("grace", "hash", "grace@example.com");
        var now = DateTimeOffset.UtcNow;
        store.SaveEmailCode(user.Id, EmailCodePurpose.Verify, "v", now.AddHours(1));
        store.SaveEmailCode(user.Id, EmailCodePurpose.Reset, "r", now.AddHours(1));
        store.SetEmail(user.Id, "grace2@example.com", false);
        Assert.Null(store.EmailCodeSentAt(user.Id, EmailCodePurpose.Verify));
        Assert.NotNull(store.EmailCodeSentAt(user.Id, EmailCodePurpose.Reset));
    }

    public static void RemovingAUserRemovesTheirCodes(IUserStore store)
    {
        var user = store.CreateWithPassword("heidi", "hash", "heidi@example.com");
        store.SaveEmailCode(user.Id, EmailCodePurpose.Verify, "v", DateTimeOffset.UtcNow.AddHours(1));
        Assert.True(store.Remove("heidi"));
        Assert.Null(store.EmailCodeSentAt(user.Id, EmailCodePurpose.Verify));
    }
}

public class SqliteEmailStoreTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"sf-mail-{Guid.NewGuid():N}.db");
    private IUserStore Store() => new SqliteUserStore(_path);

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (File.Exists(_path)) File.Delete(_path);
    }

    [Fact] public void EmailAddresses() => EmailStoreContract.EmailAddresses(Store());
    [Fact] public void Codes() => EmailStoreContract.Codes(Store());
    [Fact] public void CodesArePerPurpose() => EmailStoreContract.CodesArePerPurpose_AndDeletable(Store());
    [Fact] public void ChangingTheAddress() => EmailStoreContract.ChangingTheAddressDropsPendingVerificationCodes(Store());
    [Fact] public void RemovingAUser() => EmailStoreContract.RemovingAUserRemovesTheirCodes(Store());

    [Fact]
    public void CodesAreStoredOnlyAsHashes()
    {
        var store = Store();
        var user = store.CreateWithPassword("ivan", "hash", "ivan@example.com");
        var hash = EmailCodes.Hash(user.Id, EmailCodePurpose.Verify, "12345678");
        store.SaveEmailCode(user.Id, EmailCodePurpose.Verify, hash, DateTimeOffset.UtcNow.AddHours(1));
        using var connection = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={_path}");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT group_concat(CodeHash) FROM EmailCodes;";
        var stored = (string)command.ExecuteScalar()!;
        Assert.DoesNotContain("12345678", stored);
    }

    // A users.db from before email addresses existed (the #352 shape) keeps working.
    [Fact]
    public void AnOlderUsersDatabase_GainsTheEmailColumnsAndTable()
    {
        using (var connection = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={_path}"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = """
                CREATE TABLE Users (Id INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT NOT NULL UNIQUE COLLATE NOCASE, KeyHash TEXT NOT NULL UNIQUE, CreatedAt TEXT NOT NULL,
                    PasswordHash TEXT NULL, Disabled INTEGER NOT NULL DEFAULT 0);
                INSERT INTO Users (Name, KeyHash, CreatedAt) VALUES ('old', 'abc', '2025-01-01');
                """;
            command.ExecuteNonQuery();
        }

        var store = Store();
        var old = store.FindByName("old")!;
        Assert.Null(old.Email);
        Assert.True(store.SetEmail(old.Id, "old@example.com", false));
        _ = new SqliteUserStore(_path); // opening again must not fail either
    }
}

public class MySqlEmailStoreTests
{
    private static void With(Action<IUserStore> test)
    {
        using var database = new MySqlTestDatabase();
        test(new MySqlUserStore(database.ConnectionString));
    }

    [MySqlFact] public void EmailAddresses() => With(EmailStoreContract.EmailAddresses);
    [MySqlFact] public void Codes() => With(EmailStoreContract.Codes);
    [MySqlFact] public void CodesArePerPurpose() => With(EmailStoreContract.CodesArePerPurpose_AndDeletable);
    [MySqlFact] public void ChangingTheAddress() => With(EmailStoreContract.ChangingTheAddressDropsPendingVerificationCodes);
    [MySqlFact] public void RemovingAUser() => With(EmailStoreContract.RemovingAUserRemovesTheirCodes);
}

// ── The mail sender, against a tiny SMTP server ──────────────────────────────

internal sealed class FakeSmtpServer : IDisposable
{
    private readonly TcpListener _listener = new(IPAddress.Loopback, 0);
    private readonly CancellationTokenSource _stop = new();
    public List<string> Messages { get; } = [];
    public int Port => ((IPEndPoint)_listener.LocalEndpoint).Port;

    public FakeSmtpServer()
    {
        _listener.Start();
        _ = Task.Run(async () =>
        {
            while (!_stop.IsCancellationRequested)
            {
                try { await Serve(await _listener.AcceptTcpClientAsync(_stop.Token)); }
                catch { return; }
            }
        });
    }

    private async Task Serve(TcpClient client)
    {
        using var _ = client;
        using var stream = client.GetStream();
        using var reader = new StreamReader(stream, Encoding.ASCII);
        using var writer = new StreamWriter(stream, new ASCIIEncoding()) { NewLine = "\r\n", AutoFlush = true };
        await writer.WriteLineAsync("220 localhost ready");
        while (await reader.ReadLineAsync() is { } line)
        {
            var command = line.Split(' ')[0].ToUpperInvariant();
            switch (command)
            {
                case "EHLO": await writer.WriteLineAsync("250-localhost"); await writer.WriteLineAsync("250 8BITMIME"); break;
                case "DATA":
                    await writer.WriteLineAsync("354 go ahead");
                    var data = new StringBuilder();
                    while (await reader.ReadLineAsync() is { } dataLine && dataLine != ".") data.AppendLine(dataLine);
                    lock (Messages) Messages.Add(data.ToString());
                    await writer.WriteLineAsync("250 queued");
                    break;
                case "QUIT": await writer.WriteLineAsync("221 bye"); return;
                default: await writer.WriteLineAsync("250 OK"); break;
            }
        }
    }

    public void Dispose() { _stop.Cancel(); _listener.Stop(); }
}

public class SmtpEmailSenderTests
{
    [Fact]
    public async Task ASentMessage_ArrivesWithSubjectRecipientAndBody()
    {
        using var server = new FakeSmtpServer();
        var sender = new SmtpEmailSender(new SmtpSettings("127.0.0.1", server.Port, SmtpSecurity.None, null, null, "noreply@example.com"));

        await sender.SendAsync(EmailMessages.Verification("alice@example.com", "alice", "12345678"));

        var message = Assert.Single(server.Messages);
        Assert.Contains("To: alice@example.com", message);
        Assert.Contains("From: noreply@example.com", message);
        Assert.Contains("Subject: Scraping Factory: confirm your email address", message);
        Assert.Contains("12345678", message);
    }

    [Fact]
    public async Task AnUnreachableServer_ThrowsInsteadOfPretending()
    {
        var closed = new TcpListener(IPAddress.Loopback, 0);
        closed.Start();
        var port = ((IPEndPoint)closed.LocalEndpoint).Port;
        closed.Stop();
        var sender = new SmtpEmailSender(new SmtpSettings("127.0.0.1", port, SmtpSecurity.None, null, null, "noreply@example.com"));
        await Assert.ThrowsAnyAsync<Exception>(() => sender.SendAsync(EmailMessages.PasswordReset("a@example.com", "alice", "12345678")));
    }

    [Fact]
    public void TheResetMailNamesTheAccount_AndSaysItIsSafeToIgnore()
    {
        var mail = EmailMessages.PasswordReset("a@example.com", "alice", "87654321");
        Assert.Contains("'alice'", mail.Body);
        Assert.Contains("87654321", mail.Body);
        Assert.Contains("ignore", mail.Body);
        Assert.DoesNotContain("password has been changed", mail.Body);
    }
}

// ── The endpoints, with a fake mailer ────────────────────────────────────────

internal sealed class FakeEmailSender : IEmailSender
{
    public List<EmailMessage> Sent { get; } = [];
    public bool Fail { get; set; }

    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        if (Fail) throw new InvalidOperationException("SMTP is down");
        lock (Sent) Sent.Add(message);
        return Task.CompletedTask;
    }

    public EmailMessage[] To(string address) { lock (Sent) return Sent.Where(m => m.To == address).ToArray(); }

    public static string CodeIn(EmailMessage message) => Regex.Match(message.Body, @"\b(\d{8})\b").Groups[1].Value;

    // The reset mail is sent in the background.
    public async Task<EmailMessage> WaitFor(string address, int count = 1)
    {
        for (var i = 0; i < 100; i++)
        {
            if (To(address).Length >= count) return To(address)[count - 1];
            await Task.Delay(50);
        }
        throw new TimeoutException($"No mail to {address} arrived.");
    }
}

public class EmailEndpointTests : IDisposable
{
    private readonly List<string> _files = [];
    private WebApplicationFactory<Program>? _factory;
    private readonly FakeEmailSender _mail = new();
    private const string Password = "a-sufficiently-long-password";
    private const string NewPassword = "another-long-password-1";

    private WebApplicationFactory<Program> Factory(Dictionary<string, string?>? extra = null, bool smtp = true)
    {
        var settings = TestCompanionFactory.TempDatabaseSettings("mail-ep", _files);
        settings[AuthOptions.EnabledKey] = "true";
        settings[AuthOptions.RegistrationKey] = "Open";
        if (smtp)
        {
            settings[EmailOptions.SmtpHostKey] = "127.0.0.1";
            settings["Companion:Email:Smtp:Security"] = "None";
            settings["Companion:Email:Smtp:From"] = "noreply@example.com";
        }
        foreach (var (key, value) in extra ?? []) settings[key] = value;
        _factory = TestCompanionFactory.Create(settings, builder =>
            builder.ConfigureTestServices(services => services.AddSingleton<IEmailSender>(_mail)));
        return _factory;
    }

    public void Dispose()
    {
        _factory?.Dispose();
        TestCompanionFactory.DeleteDatabases(_files);
    }

    private static StringContent Json(object payload) => new(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

    private static async Task<(HttpStatusCode Status, JsonElement Body, HttpResponseMessage Response)> Post(HttpClient client, string path, object? payload = null)
    {
        var response = await client.PostAsync(path, Json(payload ?? new { }));
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, text.Length == 0 ? default : JsonDocument.Parse(text).RootElement, response);
    }

    private static HttpClient WithToken(HttpClient client, string token)
    {
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static string Error(JsonElement body) => body.GetProperty("error").GetString()!;

    private async Task<(HttpClient Client, string Token)> Register(HttpClient anonymous, string name, string? email, bool verify = false)
    {
        var (status, body, _) = await Post(anonymous, "/auth/register", new { name, password = Password, email });
        Assert.Equal(HttpStatusCode.Created, status);
        var token = body.GetProperty("token").GetString()!;
        var signedIn = WithToken(_factory!.CreateClient(), token);
        if (verify)
        {
            var code = FakeEmailSender.CodeIn(Assert.Single(_mail.To(email!)));
            Assert.Equal(HttpStatusCode.OK, (await Post(signedIn, "/auth/verify-email", new { code })).Status);
        }
        return (signedIn, token);
    }

    // ── health / whoami ──

    [Fact]
    public async Task Health_ReportsWhatEmailCanDo()
    {
        using var off = Factory(smtp: false).CreateClient();
        var h = await off.GetFromJsonAsync<JsonElement>("/health");
        Assert.Equal("off", h.GetProperty("email").GetString());
        Assert.False(h.GetProperty("passwordReset").GetBoolean());
        Assert.False(h.GetProperty("verifiedEmailRequired").GetBoolean());
        _factory!.Dispose();

        using var optional = Factory().CreateClient();
        h = await optional.GetFromJsonAsync<JsonElement>("/health");
        Assert.Equal("optional", h.GetProperty("email").GetString());
        Assert.True(h.GetProperty("passwordReset").GetBoolean());
        _factory.Dispose();

        using var strict = Factory(new() { [EmailOptions.RequiredKey] = "true", [EmailOptions.RequireVerifiedKey] = "true" }).CreateClient();
        h = await strict.GetFromJsonAsync<JsonElement>("/health");
        Assert.Equal("required", h.GetProperty("email").GetString());
        Assert.True(h.GetProperty("verifiedEmailRequired").GetBoolean());
    }

    [Fact]
    public async Task WithoutAuthentication_EmailStaysOff_AndWhoamiDoesNotTouchTheUserStore()
    {
        using var client = new WebApplicationFactory<Program>().CreateClient();
        var h = await client.GetFromJsonAsync<JsonElement>("/health");
        Assert.Equal("off", h.GetProperty("email").GetString());
        var whoami = await client.GetFromJsonAsync<JsonElement>("/whoami");
        Assert.False(whoami.GetProperty("authRequired").GetBoolean());
        Assert.Equal(JsonValueKind.Null, whoami.GetProperty("email").ValueKind);
    }

    // ── registration ──

    [Fact]
    public async Task Register_WithAnEmail_MailsACode_AndTheAccountStartsUnverified()
    {
        using var anonymous = Factory().CreateClient();
        var (status, body, _) = await Post(anonymous, "/auth/register", new { name = "alice", password = Password, email = "Alice@Example.com" });

        Assert.Equal(HttpStatusCode.Created, status);
        Assert.Equal("alice@example.com", body.GetProperty("email").GetString());
        Assert.False(body.GetProperty("emailVerified").GetBoolean());
        Assert.True(body.GetProperty("verificationSent").GetBoolean());
        var mail = Assert.Single(_mail.To("alice@example.com"));
        Assert.Matches(@"\b\d{8}\b", mail.Body);

        var whoami = await WithToken(_factory!.CreateClient(), body.GetProperty("token").GetString()!).GetFromJsonAsync<JsonElement>("/whoami");
        Assert.Equal("alice@example.com", whoami.GetProperty("email").GetString());
        Assert.False(whoami.GetProperty("emailVerified").GetBoolean());
    }

    [Fact]
    public async Task Register_WithoutAnEmail_StillWorks_WhenItIsOptional()
    {
        using var anonymous = Factory().CreateClient();
        var (status, body, _) = await Post(anonymous, "/auth/register", new { name = "alice", password = Password });
        Assert.Equal(HttpStatusCode.Created, status);
        Assert.Equal(JsonValueKind.Null, body.GetProperty("email").ValueKind);
        Assert.Empty(_mail.Sent);
    }

    [Fact]
    public async Task Register_RequiresAnEmail_WhenTheOperatorSaysSo()
    {
        using var anonymous = Factory(new() { [EmailOptions.RequiredKey] = "true" }).CreateClient();
        var (status, body, _) = await Post(anonymous, "/auth/register", new { name = "alice", password = Password });
        Assert.Equal(HttpStatusCode.BadRequest, status);
        Assert.Contains("required", Error(body));
    }

    [Fact]
    public async Task Register_RefusesBadAddresses_ForeignDomains_AndDuplicates()
    {
        using var anonymous = Factory(new() { [EmailOptions.AllowedDomainsKey] = "example.com" }).CreateClient();
        Assert.Contains("valid", Error((await Post(anonymous, "/auth/register", new { name = "a1", password = Password, email = "nonsense" })).Body));
        Assert.Contains("domain", Error((await Post(anonymous, "/auth/register", new { name = "a2", password = Password, email = "a@other.org" })).Body));

        Assert.Equal(HttpStatusCode.Created, (await Post(anonymous, "/auth/register", new { name = "a3", password = Password, email = "dup@example.com" })).Status);
        var (status, body, _) = await Post(anonymous, "/auth/register", new { name = "a4", password = Password, email = "DUP@example.com" });
        Assert.Equal(HttpStatusCode.Conflict, status);
        Assert.Contains("already registered", Error(body));
        // The failed registration did not leave an account behind.
        Assert.Equal(HttpStatusCode.Created, (await Post(anonymous, "/auth/register", new { name = "a4", password = Password, email = "other@example.com" })).Status);
    }

    [Fact]
    public async Task Register_WithAnEmail_IsRefused_WhenTheCompanionDoesNotCollectAddresses()
    {
        using var anonymous = Factory(smtp: false).CreateClient();
        var (status, body, _) = await Post(anonymous, "/auth/register", new { name = "alice", password = Password, email = "a@example.com" });
        Assert.Equal(HttpStatusCode.BadRequest, status);
        Assert.Contains("does not collect", Error(body));
    }

    [Fact]
    public async Task Register_StillSucceeds_WhenTheMailCannotBeSent()
    {
        using var anonymous = Factory().CreateClient();
        _mail.Fail = true;
        var (status, body, _) = await Post(anonymous, "/auth/register", new { name = "alice", password = Password, email = "a@example.com" });
        Assert.Equal(HttpStatusCode.Created, status);
        Assert.False(body.GetProperty("verificationSent").GetBoolean());
    }

    // ── verification ──

    [Fact]
    public async Task VerifyEmail_AcceptsTheMailedCode_Once()
    {
        using var anonymous = Factory().CreateClient();
        var (alice, _) = await Register(anonymous, "alice", "alice@example.com");
        var code = FakeEmailSender.CodeIn(Assert.Single(_mail.To("alice@example.com")));

        var (status, body, _) = await Post(alice, "/auth/verify-email", new { code = code.Insert(4, " ") });   // typed with a space
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.True(body.GetProperty("emailVerified").GetBoolean());
        Assert.True((await alice.GetFromJsonAsync<JsonElement>("/whoami")).GetProperty("emailVerified").GetBoolean());
        Assert.Equal(HttpStatusCode.OK, (await Post(alice, "/auth/verify-email", new { code })).Status);        // idempotent once verified
    }

    [Fact]
    public async Task VerifyEmail_RefusesWrongCodes_AndLocksTheCodeAfterFiveGuesses()
    {
        using var anonymous = Factory().CreateClient();
        var (alice, _) = await Register(anonymous, "alice", "alice@example.com");
        var code = FakeEmailSender.CodeIn(Assert.Single(_mail.To("alice@example.com")));
        var wrong = code == "00000000" ? "11111111" : "00000000";

        Assert.Contains("Enter the 8-digit", Error((await Post(alice, "/auth/verify-email", new { code = "12" })).Body));
        for (var i = 0; i < 5; i++)
        {
            var (status, body, _) = await Post(alice, "/auth/verify-email", new { code = wrong });
            Assert.Equal(HttpStatusCode.BadRequest, status);
            Assert.Equal("The code is wrong.", Error(body));
        }
        // Even the right code no longer works: the code is used up.
        var (lockedStatus, locked, _) = await Post(alice, "/auth/verify-email", new { code });
        Assert.Equal(HttpStatusCode.BadRequest, lockedStatus);
        Assert.Contains("Too many", Error(locked));
        Assert.Contains("expired", Error((await Post(alice, "/auth/verify-email", new { code })).Body));
    }

    [Fact]
    public async Task ResendVerification_HasACooldown_AndSendsANewCodeAfterwards()
    {
        using var anonymous = Factory().CreateClient();
        var (alice, _) = await Register(anonymous, "alice", "alice@example.com");

        var (status, body, response) = await Post(alice, "/auth/resend-verification");
        Assert.Equal(HttpStatusCode.TooManyRequests, status);
        Assert.True(response.Headers.TryGetValues("Retry-After", out var retry) && int.Parse(retry.First()) > 0);
        Assert.Contains("wait", Error(body));
        Assert.Single(_mail.To("alice@example.com"));

        // Once the cooldown is over (here: the stored code is backdated) a new mail goes out.
        var users = _factory!.Services.GetRequiredService<IUserStore>();
        var alice1 = users.FindByName("alice")!;
        users.SaveEmailCode(alice1.Id, EmailCodePurpose.Verify, "old", DateTimeOffset.UtcNow.AddHours(1));
        BackdateCode(alice1.Id);
        Assert.Equal(HttpStatusCode.Accepted, (await Post(alice, "/auth/resend-verification")).Status);
        Assert.Equal(2, _mail.To("alice@example.com").Length);
    }

    private void BackdateCode(long userId)
    {
        var path = _files.First(f => f.Contains("-users-"));
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        using var connection = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={path}");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE EmailCodes SET CreatedAt = @old WHERE UserId = @id;";
        command.Parameters.AddWithValue("@old", DateTimeOffset.UtcNow.AddHours(-1).ToString("O"));
        command.Parameters.AddWithValue("@id", userId);
        command.ExecuteNonQuery();
    }

    [Fact]
    public async Task ResendVerification_ReportsAMailServerProblem_Honestly()
    {
        using var anonymous = Factory().CreateClient();
        var (alice, _) = await Register(anonymous, "alice", "alice@example.com");
        BackdateCode(_factory!.Services.GetRequiredService<IUserStore>().FindByName("alice")!.Id);
        _mail.Fail = true;
        var (status, body, _) = await Post(alice, "/auth/resend-verification");
        Assert.Equal(HttpStatusCode.BadGateway, status);
        Assert.Contains("could not be sent", Error(body));
    }

    [Fact]
    public async Task ResendAndVerify_NeedAnAccountWithAnAddress()
    {
        using var anonymous = Factory().CreateClient();
        var (noEmail, _) = await Register(anonymous, "alice", null);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(noEmail, "/auth/resend-verification")).Status);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(noEmail, "/auth/verify-email", new { code = "12345678" })).Status);
        // Signed-out callers are refused by the key middleware.
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(anonymous, "/auth/verify-email", new { code = "12345678" })).Status);
    }

    // ── set-email ──

    [Fact]
    public async Task SetEmail_NeedsThePassword_AndStartsUnverified()
    {
        using var anonymous = Factory().CreateClient();
        var (alice, _) = await Register(anonymous, "alice", "alice@example.com", verify: true);

        var (denied, deniedBody, _) = await Post(alice, "/auth/set-email", new { email = "new@example.com", currentPassword = "nope" });
        Assert.Equal(HttpStatusCode.Unauthorized, denied);
        Assert.Contains("wrong", Error(deniedBody));
        Assert.Equal("alice@example.com", (await alice.GetFromJsonAsync<JsonElement>("/whoami")).GetProperty("email").GetString());

        var (status, body, _) = await Post(alice, "/auth/set-email", new { email = "New@Example.com", currentPassword = Password });
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("new@example.com", body.GetProperty("email").GetString());
        Assert.False(body.GetProperty("emailVerified").GetBoolean());
        Assert.True(body.GetProperty("verificationSent").GetBoolean());
        Assert.Single(_mail.To("new@example.com"));
        Assert.False((await alice.GetFromJsonAsync<JsonElement>("/whoami")).GetProperty("emailVerified").GetBoolean());
    }

    [Fact]
    public async Task SetEmail_RefusesAnAddressAnotherAccountHas_AndBadAddresses()
    {
        using var anonymous = Factory().CreateClient();
        await Register(anonymous, "bob", "bob@example.com");
        var (alice, _) = await Register(anonymous, "alice", null);

        var (status, body, _) = await Post(alice, "/auth/set-email", new { email = "bob@example.com", currentPassword = Password });
        Assert.Equal(HttpStatusCode.Conflict, status);
        Assert.Contains("already registered", Error(body));
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(alice, "/auth/set-email", new { email = "not-an-address", currentPassword = Password })).Status);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(alice, "/auth/set-email", new { email = "", currentPassword = Password })).Status);
    }

    [Fact]
    public async Task SetEmail_WithTheSameAddress_ChangesNothing()
    {
        using var anonymous = Factory().CreateClient();
        var (alice, _) = await Register(anonymous, "alice", "alice@example.com", verify: true);
        var (status, body, _) = await Post(alice, "/auth/set-email", new { email = "alice@example.com", currentPassword = Password });
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.True(body.GetProperty("emailVerified").GetBoolean());
        Assert.Single(_mail.To("alice@example.com"));
    }

    // ── forgot / reset password ──

    [Fact]
    public async Task ForgotPassword_IsNotAvailableWithoutSmtp()
    {
        using var anonymous = Factory(smtp: false).CreateClient();
        var (status, body, _) = await Post(anonymous, "/auth/forgot-password", new { account = "alice" });
        Assert.Equal(HttpStatusCode.BadRequest, status);
        Assert.Contains("not available", Error(body));
    }

    [Fact]
    public async Task ForgotPassword_AnswersTheSameForEveryone_AndMailsOnlyAVerifiedAddress()
    {
        using var anonymous = Factory().CreateClient();
        await Register(anonymous, "verified", "v@example.com", verify: true);
        await Register(anonymous, "unverified", "u@example.com");
        await Register(anonymous, "noemail", null);
        var before = _mail.Sent.Count;

        var answers = new List<string>();
        foreach (var account in new[] { "verified", "unverified", "noemail", "nobody", "v@example.com", "u@example.com", "ghost@example.com", "" })
        {
            var (status, body, _) = await Post(anonymous, "/auth/forgot-password", new { account });
            Assert.Equal(HttpStatusCode.Accepted, status);
            answers.Add(body.GetProperty("message").GetString()!);
        }
        Assert.Single(answers.Distinct());

        await _mail.WaitFor("v@example.com", 2);                       // the verification mail plus the reset mail
        await Task.Delay(300);
        Assert.Empty(_mail.To("ghost@example.com"));
        Assert.Single(_mail.To("u@example.com"));                      // only the verification mail
        Assert.Equal(before + 1 /* verified by name */, _mail.Sent.Count);   // by name and by address within the cooldown: one mail
    }

    [Fact]
    public async Task ResetPassword_WithTheMailedCode_SetsThePassword_AndSignsEveryDeviceOut()
    {
        using var anonymous = Factory().CreateClient();
        var (alice, token) = await Register(anonymous, "alice", "alice@example.com", verify: true);
        await Post(anonymous, "/auth/forgot-password", new { account = "alice@example.com" });
        var reset = await _mail.WaitFor("alice@example.com", 2);
        Assert.Contains("password reset", reset.Subject);
        var code = FakeEmailSender.CodeIn(reset);

        var (status, _, _) = await Post(anonymous, "/auth/reset-password", new { account = "alice", code, newPassword = NewPassword });
        Assert.Equal(HttpStatusCode.NoContent, status);

        Assert.Equal(HttpStatusCode.Unauthorized, (await alice.GetAsync("/whoami")).StatusCode);          // the old token is revoked
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(anonymous, "/auth/login", new { name = "alice", password = Password })).Status);
        var (loginStatus, login, _) = await Post(anonymous, "/auth/login", new { name = "alice", password = NewPassword });
        Assert.Equal(HttpStatusCode.OK, loginStatus);
        Assert.True(login.GetProperty("emailVerified").GetBoolean());
        Assert.NotEqual(token, login.GetProperty("token").GetString());

        // The code is single-use.
        var (again, againBody, _) = await Post(anonymous, "/auth/reset-password", new { account = "alice", code, newPassword = "yet-another-long-password" });
        Assert.Equal(HttpStatusCode.BadRequest, again);
        Assert.Contains("wrong or has expired", Error(againBody));
    }

    [Fact]
    public async Task ResetPassword_FailsTheSameWay_ForWrongCodes_UnknownAccounts_AndUnverifiedAddresses()
    {
        using var anonymous = Factory().CreateClient();
        await Register(anonymous, "alice", "alice@example.com", verify: true);
        await Register(anonymous, "unverified", "u@example.com");
        await Post(anonymous, "/auth/forgot-password", new { account = "alice" });
        var code = FakeEmailSender.CodeIn(await _mail.WaitFor("alice@example.com", 2));
        var wrong = code == "00000000" ? "11111111" : "00000000";

        var messages = new HashSet<string>();
        foreach (var account in new[] { "alice", "nobody", "unverified" })
        {
            var (status, body, _) = await Post(anonymous, "/auth/reset-password", new { account, code = wrong, newPassword = NewPassword });
            Assert.Equal(HttpStatusCode.BadRequest, status);
            messages.Add(Error(body));
        }
        Assert.Single(messages);

        // A code for one account does not work for another.
        var (cross, _, _) = await Post(anonymous, "/auth/reset-password", new { account = "unverified", code, newPassword = NewPassword });
        Assert.Equal(HttpStatusCode.BadRequest, cross);
        // The password was not touched.
        Assert.Equal(HttpStatusCode.OK, (await Post(anonymous, "/auth/login", new { name = "alice", password = Password })).Status);
    }

    [Fact]
    public async Task ResetPassword_AppliesThePasswordPolicy_BeforeSpendingTheCode()
    {
        using var anonymous = Factory().CreateClient();
        await Register(anonymous, "alice", "alice@example.com", verify: true);
        await Post(anonymous, "/auth/forgot-password", new { account = "alice" });
        var code = FakeEmailSender.CodeIn(await _mail.WaitFor("alice@example.com", 2));

        var (status, body, _) = await Post(anonymous, "/auth/reset-password", new { account = "alice", code, newPassword = "short" });
        Assert.Equal(HttpStatusCode.BadRequest, status);
        Assert.Contains("at least", Error(body));
        Assert.Equal(HttpStatusCode.NoContent, (await Post(anonymous, "/auth/reset-password", new { account = "alice", code, newPassword = NewPassword })).Status);
    }

    [Fact]
    public async Task ResetPassword_LocksOutAfterRepeatedWrongCodes()
    {
        using var anonymous = Factory().CreateClient();
        await Register(anonymous, "alice", "alice@example.com", verify: true);
        HttpStatusCode last = default;
        for (var i = 0; i < 8; i++)
            last = (await Post(anonymous, "/auth/reset-password", new { account = "alice", code = "00000000", newPassword = NewPassword })).Status;
        Assert.Equal(HttpStatusCode.TooManyRequests, last);
    }

    [Fact]
    public async Task ADisabledUser_CannotResetAPassword()
    {
        using var anonymous = Factory().CreateClient();
        await Register(anonymous, "alice", "alice@example.com", verify: true);
        await Post(anonymous, "/auth/forgot-password", new { account = "alice" });
        var code = FakeEmailSender.CodeIn(await _mail.WaitFor("alice@example.com", 2));
        _factory!.Services.GetRequiredService<IUserStore>().SetDisabled("alice", true);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(anonymous, "/auth/reset-password", new { account = "alice", code, newPassword = NewPassword })).Status);
    }

    // ── the RequireVerified rule ──

    [Fact]
    public async Task RequireVerified_KeepsAnUnverifiedAccountFromTheData_UntilItConfirmsItsAddress()
    {
        using var anonymous = Factory(new() { [EmailOptions.RequireVerifiedKey] = "true" }).CreateClient();
        var (alice, _) = await Register(anonymous, "alice", "alice@example.com");

        var blocked = await alice.GetAsync("/configs");
        Assert.Equal(HttpStatusCode.Forbidden, blocked.StatusCode);
        var body = await blocked.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("email_unverified", body.GetProperty("code").GetString());
        Assert.Contains("code from the email", Error(body));
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(alice, "/generate", new { })).Status);

        // Signing in, seeing who one is and the account endpoints keep working.
        Assert.Equal(HttpStatusCode.OK, (await alice.GetAsync("/whoami")).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await Post(alice, "/auth/resend-verification")).Status);   // an account endpoint, answered (cooldown)
        var code = FakeEmailSender.CodeIn(Assert.Single(_mail.To("alice@example.com")));
        Assert.Equal(HttpStatusCode.OK, (await Post(alice, "/auth/verify-email", new { code })).Status);
        Assert.Equal(HttpStatusCode.OK, (await alice.GetAsync("/configs")).StatusCode);
    }

    [Fact]
    public async Task RequireVerified_AlsoCoversAKeyOnlyAccount_UntilItAddsAnAddress()
    {
        var factory = Factory(new() { [EmailOptions.RequireVerifiedKey] = "true" });
        using var anonymous = factory.CreateClient();
        var (_, key) = factory.Services.GetRequiredService<IUserStore>().Create("legacy");
        var legacy = WithToken(factory.CreateClient(), key);

        var blocked = await legacy.GetAsync("/configs");
        Assert.Equal(HttpStatusCode.Forbidden, blocked.StatusCode);
        Assert.Contains("add one", Error(await blocked.Content.ReadFromJsonAsync<JsonElement>()));

        // No password yet, so no password prompt either.
        Assert.Equal(HttpStatusCode.OK, (await Post(legacy, "/auth/set-email", new { email = "legacy@example.com" })).Status);
        var code = FakeEmailSender.CodeIn(Assert.Single(_mail.To("legacy@example.com")));
        await Post(legacy, "/auth/verify-email", new { code });
        Assert.Equal(HttpStatusCode.OK, (await legacy.GetAsync("/configs")).StatusCode);
    }

    [Fact]
    public async Task WithoutTheRule_AnUnverifiedAccountWorksNormally()
    {
        using var anonymous = Factory().CreateClient();
        var (alice, _) = await Register(anonymous, "alice", "alice@example.com");
        Assert.Equal(HttpStatusCode.OK, (await alice.GetAsync("/configs")).StatusCode);
    }

    [Fact]
    public async Task Login_ReportsTheEmailState()
    {
        using var anonymous = Factory().CreateClient();
        await Register(anonymous, "alice", "alice@example.com");
        var (_, login, _) = await Post(anonymous, "/auth/login", new { name = "alice", password = Password });
        Assert.Equal("alice@example.com", login.GetProperty("email").GetString());
        Assert.False(login.GetProperty("emailVerified").GetBoolean());
    }
}

// ── The `user` commands ──────────────────────────────────────────────────────

public class EmailCommandsTests : IDisposable
{
    private readonly List<string> _files = [];
    private readonly IConfiguration _configuration;

    public EmailCommandsTests()
    {
        string Db(string name) { var p = Path.Combine(Path.GetTempPath(), $"sf-mail-cli-{name}-{Guid.NewGuid():N}.db"); _files.Add(p); return p; }
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
    public void SetEmail_StoresItUnverified_AndListShowsTheState()
    {
        Run("add", "alice");
        Assert.Equal(0, Run("set-email", "alice", "Alice@Example.com").Code);
        Assert.Contains("alice@example.com [unverified]", Run("list").Out);

        Assert.Equal(0, Run("verify", "alice").Code);
        Assert.Contains("alice@example.com [verified]", Run("list").Out);
    }

    [Fact]
    public void SetEmail_WithVerified_SkipsTheMailedCode()
    {
        Run("add", "alice");
        Assert.Equal(0, Run("set-email", "alice", "alice@example.com", "--verified").Code);
        Assert.Contains("[verified]", Run("list").Out);
    }

    [Fact]
    public void SetEmail_RefusesBadAddresses_UnknownUsers_AndAddressesInUse()
    {
        Run("add", "alice");
        Run("add", "bob");
        Assert.Equal(2, Run("set-email", "alice", "nonsense").Code);
        var (code, _, error) = Run("set-email", "nobody", "x@example.com");
        Assert.Equal(1, code);
        Assert.Contains("No user named", error);
        Run("set-email", "alice", "same@example.com");
        Assert.Contains("belongs to another user", Run("set-email", "bob", "same@example.com").Err);
    }

    [Fact]
    public void Verify_NeedsAnAddress()
    {
        Run("add", "alice");
        var (code, _, error) = Run("verify", "alice");
        Assert.Equal(1, code);
        Assert.Contains("no email address", error);
    }
}
