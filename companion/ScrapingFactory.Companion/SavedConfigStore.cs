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
public sealed record SavedConfigSummary(long Id, string Url, string Name, string SavedAt, long? BlueprintId = null);

public sealed record SavedConfigRecord(long Id, string Url, string Name, string SavedAt, string ConfigJson, long? BlueprintId = null);

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
        using (var command = connection.CreateCommand())
        {
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

        // Issue #207: which persisted Output Blueprint (if any) this saved
        // config's own OutputBlueprint mapping was built against — derived
        // once, at save time, from the already-parsed ConfigJson's own
        // "outputBlueprint.blueprintId" (see Save below), rather than
        // parsing ConfigJson's structure again on every later query. This is
        // the one exception to ConfigJson's own "deliberately opaque, never
        // parsed for its structure" convention (see this file's own top-of-
        // file doc comment) — accepted specifically because indexing this
        // one value is what makes "every saved output sharing Blueprint X"
        // a single SQL join instead of a full-table JSON-parsing scan on
        // every hardening-replay request. Added via the same idempotent
        // ALTER TABLE-if-missing pattern OutputBlueprintStore already
        // established for its own SchemaKind/TreeJson columns, so an
        // existing saved-configs.db keeps working unchanged.
        AddColumnIfMissing(connection, "SavedConfigs", "BlueprintId", "INTEGER NULL");
    }

    private static void AddColumnIfMissing(SqliteConnection connection, string tableName, string columnName, string columnDefinition)
    {
        using (var checkCommand = connection.CreateCommand())
        {
            checkCommand.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('{tableName}') WHERE name = @name;";
            checkCommand.Parameters.AddWithValue("@name", columnName);
            if ((long)checkCommand.ExecuteScalar()! > 0)
                return;
        }

        using var alterCommand = connection.CreateCommand();
        alterCommand.CommandText = $"ALTER TABLE {tableName} ADD COLUMN {columnName} {columnDefinition};";
        alterCommand.ExecuteNonQuery();
    }

    // blueprintId is pulled by the caller (Program.cs) out of the same
    // ConfigJson it's about to store here, from that JSON's own
    // "outputBlueprint.blueprintId" — see IR/OutputBlueprintMapping.cs's own
    // doc comment on why that property exists at all ("a later cross-
    // configuration hardening-comparison feature scoped by blueprint" —
    // this is that feature). Null when the config has no Output Blueprint
    // mapping set, same as the wire field itself.
    public SavedConfigSummary Save(string url, string name, string configJson, long? blueprintId = null)
    {
        var savedAt = DateTimeOffset.UtcNow.ToString("O");
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO SavedConfigs (Url, Host, Name, SavedAt, ConfigJson, BlueprintId)
            VALUES (@url, @host, @name, @savedAt, @configJson, @blueprintId);
            SELECT last_insert_rowid();
            """;
        command.Parameters.AddWithValue("@url", url);
        command.Parameters.AddWithValue("@host", ComputeHost(url));
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@savedAt", savedAt);
        command.Parameters.AddWithValue("@configJson", configJson);
        command.Parameters.AddWithValue("@blueprintId", (object?)blueprintId ?? DBNull.Value);
        var id = (long)command.ExecuteScalar()!;
        return new SavedConfigSummary(id, url, name, savedAt, blueprintId);
    }

    public IReadOnlyList<SavedConfigSummary> ListByUrl(string url)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT Id, Url, Name, SavedAt, BlueprintId FROM SavedConfigs
            WHERE Host = @host
            ORDER BY SavedAt DESC;
            """;
        command.Parameters.AddWithValue("@host", ComputeHost(url));

        var results = new List<SavedConfigSummary>();
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            results.Add(new SavedConfigSummary(
                reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetInt64(4)));
        }
        return results;
    }

    // Issue #239: unscoped counterpart to ListByUrl — every saved config
    // regardless of host, needed by Combined mode's component picker (a
    // component can come from any previously-scraped site).
    public IReadOnlyList<SavedConfigSummary> ListAll()
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Url, Name, SavedAt, BlueprintId FROM SavedConfigs ORDER BY SavedAt DESC;";

        var results = new List<SavedConfigSummary>();
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            results.Add(new SavedConfigSummary(
                reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetInt64(4)));
        }
        return results;
    }

    public SavedConfigRecord? Get(long id)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Url, Name, SavedAt, ConfigJson, BlueprintId FROM SavedConfigs WHERE Id = @id;";
        command.Parameters.AddWithValue("@id", id);

        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        return new SavedConfigRecord(
            reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4),
            reader.IsDBNull(5) ? null : reader.GetInt64(5));
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

    // Issue #207: the "same saved configuration" comparison basis for a
    // BaselineCheck replay — the most recently saved output for this exact
    // config, excluding the output currently being evaluated (which would
    // otherwise always compare an output against itself, a guaranteed
    // "no drop"). Closest in spirit to the live runtime's own Baseline
    // check, just sourced from this SQLite history instead of a script-local
    // sidecar file.
    public SavedOutputSummary? GetMostRecentOutputForConfig(long savedConfigId, long excludeOutputId)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT Id, SavedConfigId, Name, FileName, SavedAt FROM SavedOutputs
            WHERE SavedConfigId = @savedConfigId AND Id != @excludeOutputId
            ORDER BY SavedAt DESC
            LIMIT 1;
            """;
        command.Parameters.AddWithValue("@savedConfigId", savedConfigId);
        command.Parameters.AddWithValue("@excludeOutputId", excludeOutputId);

        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        return new SavedOutputSummary(
            reader.GetInt64(0), reader.GetInt64(1), reader.GetString(2), reader.GetString(3), reader.GetString(4));
    }

    // Issue #207: the "same Output Blueprint" comparison basis — the most
    // recently saved output across *any* saved configuration sharing this
    // Blueprint (potentially an entirely different site's own scraper),
    // excluding the output currently being evaluated. One join against the
    // BlueprintId column EnsureCreated adds above, rather than a full-table
    // scan parsing every config's own ConfigJson.
    public SavedOutputSummary? GetMostRecentOutputForBlueprint(long blueprintId, long excludeOutputId)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT o.Id, o.SavedConfigId, o.Name, o.FileName, o.SavedAt
            FROM SavedOutputs o
            JOIN SavedConfigs c ON c.Id = o.SavedConfigId
            WHERE c.BlueprintId = @blueprintId AND o.Id != @excludeOutputId
            ORDER BY o.SavedAt DESC
            LIMIT 1;
            """;
        command.Parameters.AddWithValue("@blueprintId", blueprintId);
        command.Parameters.AddWithValue("@excludeOutputId", excludeOutputId);

        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        return new SavedOutputSummary(
            reader.GetInt64(0), reader.GetInt64(1), reader.GetString(2), reader.GetString(3), reader.GetString(4));
    }
}
