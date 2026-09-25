using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;

namespace ScrapingFactory.Companion;

// Issue #191: a small, independent local table of named, reusable target
// field-name lists ("Output Blueprints") — created/edited/deleted
// independently of any single scraper configuration, unlike SavedConfigs
// (Issue #141), which is always tied to the URL/page it was saved from.
// Its own SQLite file/class (not a third table on SavedConfigStore) since
// there's no foreign-key relationship to a saved config the way
// SavedOutputs has to SavedConfigs — a blueprint is meant to be reused
// across entirely different sites/configurations. FieldNamesJson stores the
// ordered list of target field names verbatim as a JSON array of strings —
// simple enough (a plain string list, not a nested wire format like
// ScrapingConfig) that round-tripping it through System.Text.Json here is
// no less "opaque storage" in spirit than SavedConfigStore.ConfigJson's own
// verbatim-text treatment.
public sealed record OutputBlueprintSummary(long Id, string Name, string SavedAt, int FieldCount);

public sealed record OutputBlueprintRecord(long Id, string Name, string SavedAt, List<string> FieldNames);

public sealed class OutputBlueprintStore
{
    private readonly string _connectionString;

    public OutputBlueprintStore(IConfiguration configuration)
        : this(ResolveDbPath(configuration))
    {
    }

    public OutputBlueprintStore(string dbPath)
    {
        _connectionString = new SqliteConnectionStringBuilder { DataSource = dbPath }.ToString();
        EnsureCreated();
    }

    // Companion:OutputBlueprintsDbPath (env var
    // Companion__OutputBlueprintsDbPath, or a test-only override) follows
    // the exact same configuration-precedence pattern
    // SavedConfigStore.ResolveDbPath already establishes. Unset in normal
    // use: the store lives in the same per-user app-data directory as
    // saved-configs.db, just its own file — kept separate rather than a
    // third table there, per this class's own doc comment above.
    public static string ResolveDbPath(IConfiguration configuration)
    {
        var configured = configuration["Companion:OutputBlueprintsDbPath"];
        if (!string.IsNullOrWhiteSpace(configured))
            return configured;

        var appDataDir = Environment.GetFolderPath(
            Environment.SpecialFolder.ApplicationData, Environment.SpecialFolderOption.Create);
        var dir = Path.Combine(appDataDir, "ScrapingFactory");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, "output-blueprints.db");
    }

    private SqliteConnection OpenConnection()
    {
        var connection = new SqliteConnection(_connectionString);
        connection.Open();
        return connection;
    }

    private void EnsureCreated()
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS OutputBlueprints (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                Name TEXT NOT NULL,
                SavedAt TEXT NOT NULL,
                FieldNamesJson TEXT NOT NULL
            );
            """;
        command.ExecuteNonQuery();
    }

    private static string SerializeFieldNames(IReadOnlyList<string> fieldNames) =>
        System.Text.Json.JsonSerializer.Serialize(fieldNames);

    private static List<string> DeserializeFieldNames(string json) =>
        System.Text.Json.JsonSerializer.Deserialize<List<string>>(json)!;

    public OutputBlueprintSummary Save(string name, List<string> fieldNames)
    {
        var savedAt = DateTimeOffset.UtcNow.ToString("O");
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO OutputBlueprints (Name, SavedAt, FieldNamesJson)
            VALUES (@name, @savedAt, @fieldNamesJson);
            SELECT last_insert_rowid();
            """;
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@savedAt", savedAt);
        command.Parameters.AddWithValue("@fieldNamesJson", SerializeFieldNames(fieldNames));
        var id = (long)command.ExecuteScalar()!;
        return new OutputBlueprintSummary(id, name, savedAt, fieldNames.Count);
    }

    // Unscoped like SavedConfigStore.ListAll — there's no hostname (or any
    // other) scope a blueprint could be filtered by; it's meant to be
    // reusable across every site/configuration. Ordered by name rather than
    // SavedAt (unlike saved configs/outputs, which list newest-first) since
    // a blueprint picker is a small, stable set the user picks *from* by
    // name, not a history to scroll chronologically.
    public IReadOnlyList<OutputBlueprintSummary> ListAll()
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Name, SavedAt, FieldNamesJson FROM OutputBlueprints ORDER BY Name COLLATE NOCASE;";

        var results = new List<OutputBlueprintSummary>();
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            var fieldNames = DeserializeFieldNames(reader.GetString(3));
            results.Add(new OutputBlueprintSummary(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), fieldNames.Count));
        }
        return results;
    }

    public OutputBlueprintRecord? Get(long id)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Name, SavedAt, FieldNamesJson FROM OutputBlueprints WHERE Id = @id;";
        command.Parameters.AddWithValue("@id", id);

        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        return new OutputBlueprintRecord(
            reader.GetInt64(0), reader.GetString(1), reader.GetString(2), DeserializeFieldNames(reader.GetString(3)));
    }

    // Issue #191's own scope explicitly calls for edit support (unlike
    // SavedConfigs, which has no PUT) — a blueprint is a long-lived, reused
    // entity a user would reasonably want to rename or add/remove a target
    // field from, without losing its Id (every existing mapping referencing
    // it by BlueprintId stays valid, even if now stale against the current
    // field list — see OutputBlueprintMapping's own doc comment on why
    // that's an accepted, documented consequence of never re-resolving a
    // mapping against the live blueprint at generate time).
    public bool Update(long id, string name, List<string> fieldNames)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE OutputBlueprints SET Name = @name, FieldNamesJson = @fieldNamesJson WHERE Id = @id;";
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@fieldNamesJson", SerializeFieldNames(fieldNames));
        return command.ExecuteNonQuery() > 0;
    }

    public bool Delete(long id)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM OutputBlueprints WHERE Id = @id;";
        command.Parameters.AddWithValue("@id", id);
        return command.ExecuteNonQuery() > 0;
    }
}
