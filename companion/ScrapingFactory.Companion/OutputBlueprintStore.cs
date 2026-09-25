using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using ScrapingFactory.Compiler.IR;

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
//
// Issue #244: SchemaKind ("Flat"/"Tree", a plain string here — deliberately
// not the Compiler project's OutputBlueprintSchemaKind enum type, to keep
// this store's own persistence format independent of the generate-time IR
// type; PascalCase matches its wire serialization anyway, the same
// JsonStringEnumConverter convention every other enum in this codebase
// already uses, so the extension never needs to translate between two
// different casings for the "same" concept) picks which of FieldNamesJson/
// TreeJson is meaningful for a given row: a flat blueprint still only ever
// populates FieldNamesJson (TreeJson stays NULL); a tree blueprint
// populates TreeJson with its own List<OutputBlueprintTreeSchemaNode>
// instead (FieldNamesJson stays "[]"). FieldCount reports the target LEAF
// count either way — the whole tree for a tree-kind blueprint, recursively
// — so the extension's own blueprint picker can show one consistent
// "N fields" hint regardless of schema kind.
public sealed record OutputBlueprintSummary(long Id, string Name, string SavedAt, int FieldCount, string SchemaKind);

public sealed record OutputBlueprintRecord(
    long Id, string Name, string SavedAt, List<string> FieldNames, string SchemaKind, List<OutputBlueprintTreeSchemaNode>? Tree);

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
        using (var command = connection.CreateCommand())
        {
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

        // Issue #244: two new columns for the tree-shaped target schema —
        // added via an idempotent ALTER TABLE rather than baked into the
        // CREATE TABLE above, so an existing output-blueprints.db (created
        // before this feature) keeps working without the user needing to
        // delete/recreate it. SchemaKind defaults to 'Flat' for every
        // already-existing row — byte-for-byte the only schema kind that
        // existed before this feature; TreeJson stays NULL for a flat
        // blueprint either way.
        AddColumnIfMissing(connection, "SchemaKind", "TEXT NOT NULL DEFAULT 'Flat'");
        AddColumnIfMissing(connection, "TreeJson", "TEXT NULL");
    }

    private static void AddColumnIfMissing(SqliteConnection connection, string columnName, string columnDefinition)
    {
        using (var checkCommand = connection.CreateCommand())
        {
            checkCommand.CommandText = "SELECT COUNT(*) FROM pragma_table_info('OutputBlueprints') WHERE name = @name;";
            checkCommand.Parameters.AddWithValue("@name", columnName);
            if ((long)checkCommand.ExecuteScalar()! > 0)
                return;
        }

        using var alterCommand = connection.CreateCommand();
        alterCommand.CommandText = $"ALTER TABLE OutputBlueprints ADD COLUMN {columnName} {columnDefinition};";
        alterCommand.ExecuteNonQuery();
    }

    private static string SerializeFieldNames(IReadOnlyList<string> fieldNames) =>
        JsonSerializer.Serialize(fieldNames);

    private static List<string> DeserializeFieldNames(string json) =>
        JsonSerializer.Deserialize<List<string>>(json)!;

    private static readonly JsonSerializerOptions TreeJsonOptions = new()
    {
        Converters = { new OutputBlueprintTreeSchemaNodeJsonConverter() },
    };

    private static string SerializeTree(List<OutputBlueprintTreeSchemaNode> tree) =>
        JsonSerializer.Serialize(tree, TreeJsonOptions);

    private static List<OutputBlueprintTreeSchemaNode> DeserializeTree(string json) =>
        JsonSerializer.Deserialize<List<OutputBlueprintTreeSchemaNode>>(json, TreeJsonOptions)!;

    private static int CountLeaves(IReadOnlyList<OutputBlueprintTreeSchemaNode> nodes) =>
        nodes.Sum(node => node is OutputBlueprintTreeSchemaGroup group ? CountLeaves(group.Children) : 1);

    public OutputBlueprintSummary Save(string name, string schemaKind, List<string>? fieldNames, List<OutputBlueprintTreeSchemaNode>? tree)
    {
        var savedAt = DateTimeOffset.UtcNow.ToString("O");
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO OutputBlueprints (Name, SavedAt, FieldNamesJson, SchemaKind, TreeJson)
            VALUES (@name, @savedAt, @fieldNamesJson, @schemaKind, @treeJson);
            SELECT last_insert_rowid();
            """;
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@savedAt", savedAt);
        command.Parameters.AddWithValue("@fieldNamesJson", SerializeFieldNames(fieldNames ?? []));
        command.Parameters.AddWithValue("@schemaKind", schemaKind);
        command.Parameters.AddWithValue("@treeJson", tree is { Count: > 0 } ? SerializeTree(tree) : DBNull.Value);
        var id = (long)command.ExecuteScalar()!;
        var fieldCount = tree is { Count: > 0 } ? CountLeaves(tree) : (fieldNames?.Count ?? 0);
        return new OutputBlueprintSummary(id, name, savedAt, fieldCount, schemaKind);
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
        command.CommandText = "SELECT Id, Name, SavedAt, FieldNamesJson, SchemaKind, TreeJson FROM OutputBlueprints ORDER BY Name COLLATE NOCASE;";

        var results = new List<OutputBlueprintSummary>();
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            var schemaKind = reader.GetString(4);
            var fieldCount = reader.IsDBNull(5)
                ? DeserializeFieldNames(reader.GetString(3)).Count
                : CountLeaves(DeserializeTree(reader.GetString(5)));
            results.Add(new OutputBlueprintSummary(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), fieldCount, schemaKind));
        }
        return results;
    }

    public OutputBlueprintRecord? Get(long id)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Name, SavedAt, FieldNamesJson, SchemaKind, TreeJson FROM OutputBlueprints WHERE Id = @id;";
        command.Parameters.AddWithValue("@id", id);

        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        var schemaKind = reader.GetString(4);
        var tree = reader.IsDBNull(5) ? null : DeserializeTree(reader.GetString(5));
        return new OutputBlueprintRecord(
            reader.GetInt64(0), reader.GetString(1), reader.GetString(2), DeserializeFieldNames(reader.GetString(3)), schemaKind, tree);
    }

    // Issue #191's own scope explicitly calls for edit support (unlike
    // SavedConfigs, which has no PUT) — a blueprint is a long-lived, reused
    // entity a user would reasonably want to rename or add/remove a target
    // field from, without losing its Id (every existing mapping referencing
    // it by BlueprintId stays valid, even if now stale against the current
    // field list — see OutputBlueprintMapping's own doc comment on why
    // that's an accepted, documented consequence of never re-resolving a
    // mapping against the live blueprint at generate time). Issue #244:
    // SchemaKind can be changed on edit too, same as everything else —
    // there's no lifecycle reason to forbid switching an existing
    // blueprint from flat to tree or back.
    public bool Update(long id, string name, string schemaKind, List<string>? fieldNames, List<OutputBlueprintTreeSchemaNode>? tree)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE OutputBlueprints
            SET Name = @name, FieldNamesJson = @fieldNamesJson, SchemaKind = @schemaKind, TreeJson = @treeJson
            WHERE Id = @id;
            """;
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@fieldNamesJson", SerializeFieldNames(fieldNames ?? []));
        command.Parameters.AddWithValue("@schemaKind", schemaKind);
        command.Parameters.AddWithValue("@treeJson", tree is { Count: > 0 } ? SerializeTree(tree) : DBNull.Value);
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
