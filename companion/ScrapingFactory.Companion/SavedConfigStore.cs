using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;

namespace ScrapingFactory.Companion;

// One row per saved scraper configuration (Issue #141) — id, the exact url it
// was saved from, a Host column derived from that url (so "load my configs
// for this site" can match by hostname instead of requiring the exact page),
// a user-given name, a timestamp, and the config itself stored verbatim as
// JSON text. ConfigJson is deliberately opaque here (never deserialized into
// ScrapingConfig) — this store doesn't need to track the wire format's own
// ongoing evolution, only round-trip whatever JSON object the extension
// handed it (see Program.cs's /configs endpoints).
public sealed record SavedConfigSummary(long Id, string Url, string Name, string SavedAt);

public sealed record SavedConfigRecord(long Id, string Url, string Name, string SavedAt, string ConfigJson);

// Issue #202: a saved run's actual output data, linked to a SavedConfig by
// SavedConfigId — the "how a run's output actually looked" counterpart to
// the config that produced it. Deliberately opaque like ConfigJson isn't:
// Content is the exact same string /generate's own outputFile.content
// already carries (see Issue #161), stored and returned verbatim.
public sealed record SavedOutputSummary(long Id, long SavedConfigId, string Name, string FileName, string SavedAt);

public sealed record SavedOutputRecord(
    long Id, long SavedConfigId, string Name, string FileName, string SavedAt, string Content);

public sealed class SavedConfigStore
{
    private readonly string _connectionString;

    public SavedConfigStore(IConfiguration configuration)
        : this(ResolveDbPath(configuration))
    {
    }

    public SavedConfigStore(string dbPath)
    {
        _connectionString = new SqliteConnectionStringBuilder { DataSource = dbPath }.ToString();
        EnsureCreated();
    }

    // Companion:SavedConfigsDbPath (env var Companion__SavedConfigsDbPath, or
    // a test-only override — see SavedConfigsEndpointTests) follows the same
    // configuration-precedence pattern CompanionHostOptions/
    // CompanionBackendOverrides already use. Unset in normal use: the store
    // then lives in a per-user app-data directory (XDG-equivalent on Linux/
    // macOS via .NET's own SpecialFolder resolution), not the working
    // directory the companion happens to be launched from.
    public static string ResolveDbPath(IConfiguration configuration)
    {
        var configured = configuration["Companion:SavedConfigsDbPath"];
        if (!string.IsNullOrWhiteSpace(configured))
            return configured;

        var appDataDir = Environment.GetFolderPath(
            Environment.SpecialFolder.ApplicationData, Environment.SpecialFolderOption.Create);
        var dir = Path.Combine(appDataDir, "ScrapingFactory");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, "saved-configs.db");
    }

    // A saved url isn't always a well-formed absolute URI (a hand-edited
    // export could carry anything) — falls back to the raw string so lookups
    // still work consistently for that same raw value, rather than throwing.
    private static string ComputeHost(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) ? uri.Host : url;

    // Every connection goes through here so that PRAGMA foreign_keys is
    // reliably ON for every query — SQLite defaults it to OFF per connection,
    // which would silently skip SavedOutputs' own ON DELETE CASCADE (see
    // EnsureCreated) when a SavedConfig is deleted.
    private SqliteConnection OpenConnection()
    {
        var connection = new SqliteConnection(_connectionString);
        connection.Open();
        using var pragma = connection.CreateCommand();
        pragma.CommandText = "PRAGMA foreign_keys = ON;";
        pragma.ExecuteNonQuery();
        return connection;
    }

    private void EnsureCreated()
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS SavedConfigs (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                Url TEXT NOT NULL,
                Host TEXT NOT NULL,
                Name TEXT NOT NULL,
                SavedAt TEXT NOT NULL,
                ConfigJson TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS IX_SavedConfigs_Host ON SavedConfigs(Host);
            CREATE TABLE IF NOT EXISTS SavedOutputs (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                SavedConfigId INTEGER NOT NULL REFERENCES SavedConfigs(Id) ON DELETE CASCADE,
                Name TEXT NOT NULL,
                FileName TEXT NOT NULL,
                SavedAt TEXT NOT NULL,
                Content TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS IX_SavedOutputs_SavedConfigId ON SavedOutputs(SavedConfigId);
            """;
        command.ExecuteNonQuery();
    }

    public SavedConfigSummary Save(string url, string name, string configJson)
    {
        var savedAt = DateTimeOffset.UtcNow.ToString("O");
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO SavedConfigs (Url, Host, Name, SavedAt, ConfigJson)
            VALUES (@url, @host, @name, @savedAt, @configJson);
            SELECT last_insert_rowid();
            """;
        command.Parameters.AddWithValue("@url", url);
        command.Parameters.AddWithValue("@host", ComputeHost(url));
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@savedAt", savedAt);
        command.Parameters.AddWithValue("@configJson", configJson);
        var id = (long)command.ExecuteScalar()!;
        return new SavedConfigSummary(id, url, name, savedAt);
    }

    public IReadOnlyList<SavedConfigSummary> ListByUrl(string url)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT Id, Url, Name, SavedAt FROM SavedConfigs
            WHERE Host = @host
            ORDER BY SavedAt DESC;
            """;
        command.Parameters.AddWithValue("@host", ComputeHost(url));

        var results = new List<SavedConfigSummary>();
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            results.Add(new SavedConfigSummary(
                reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetString(3)));
        }
        return results;
    }

    public SavedConfigRecord? Get(long id)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Url, Name, SavedAt, ConfigJson FROM SavedConfigs WHERE Id = @id;";
        command.Parameters.AddWithValue("@id", id);

        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        return new SavedConfigRecord(
            reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4));
    }

    public bool Delete(long id)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM SavedConfigs WHERE Id = @id;";
        command.Parameters.AddWithValue("@id", id);
        return command.ExecuteNonQuery() > 0;
    }

    // Issue #202: a run's actual output data, saved as an explicit, opt-in
    // action (mirroring Save's own opt-in nature) and linked to an already-
    // saved configuration. Endpoint-level code (Program.cs) is responsible
    // for checking the parent SavedConfig actually exists before calling
    // this — the ON DELETE CASCADE above only guards against the parent
    // being deleted *after* an output was linked to it, not against linking
    // to a nonexistent id in the first place (SQLite only enforces that at
    // insert time via the same PRAGMA, which OpenConnection already sets).
    public SavedOutputSummary SaveOutput(long savedConfigId, string name, string fileName, string content)
    {
        var savedAt = DateTimeOffset.UtcNow.ToString("O");
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO SavedOutputs (SavedConfigId, Name, FileName, SavedAt, Content)
            VALUES (@savedConfigId, @name, @fileName, @savedAt, @content);
            SELECT last_insert_rowid();
            """;
        command.Parameters.AddWithValue("@savedConfigId", savedConfigId);
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@fileName", fileName);
        command.Parameters.AddWithValue("@savedAt", savedAt);
        command.Parameters.AddWithValue("@content", content);
        var id = (long)command.ExecuteScalar()!;
        return new SavedOutputSummary(id, savedConfigId, name, fileName, savedAt);
    }

    public IReadOnlyList<SavedOutputSummary> ListOutputsByConfigId(long savedConfigId)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT Id, SavedConfigId, Name, FileName, SavedAt FROM SavedOutputs
            WHERE SavedConfigId = @savedConfigId
            ORDER BY SavedAt DESC;
            """;
        command.Parameters.AddWithValue("@savedConfigId", savedConfigId);

        var results = new List<SavedOutputSummary>();
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            results.Add(new SavedOutputSummary(
                reader.GetInt64(0), reader.GetInt64(1), reader.GetString(2), reader.GetString(3), reader.GetString(4)));
        }
        return results;
    }

    public SavedOutputRecord? GetOutput(long id)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT Id, SavedConfigId, Name, FileName, SavedAt, Content FROM SavedOutputs WHERE Id = @id;";
        command.Parameters.AddWithValue("@id", id);

        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        return new SavedOutputRecord(
            reader.GetInt64(0), reader.GetInt64(1), reader.GetString(2), reader.GetString(3),
            reader.GetString(4), reader.GetString(5));
    }

    public bool DeleteOutput(long id)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM SavedOutputs WHERE Id = @id;";
        command.Parameters.AddWithValue("@id", id);
        return command.ExecuteNonQuery() > 0;
    }
}
