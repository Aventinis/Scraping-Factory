using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Companion.Storage;

// Issue #277: MySQL/MariaDB implementation of IOutputBlueprintStore — same
// contract and JSON shapes as OutputBlueprintStore (SQLite); the JSON helpers
// are shared with it. Listed by name case-insensitively (the utf8mb4 default
// collation is case-insensitive, matching SQLite's COLLATE NOCASE).
public sealed class MySqlOutputBlueprintStore : IOutputBlueprintStore
{
    private readonly string _connectionString;

    public MySqlOutputBlueprintStore(string connectionString)
    {
        _connectionString = connectionString;
        EnsureCreated();
    }

    private void EnsureCreated()
    {
        using var connection = MySqlSchema.Open(_connectionString);
        MySqlSchema.Execute(connection, """
            CREATE TABLE IF NOT EXISTS OutputBlueprints (
                Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                Name TEXT NOT NULL,
                SavedAt VARCHAR(40) NOT NULL,
                FieldNamesJson LONGTEXT NOT NULL
            ) CHARACTER SET utf8mb4;
            """);
        // Issue #244's columns, added the same idempotent way the SQLite store does.
        MySqlSchema.EnsureColumn(connection, "OutputBlueprints", "SchemaKind", "VARCHAR(16) NOT NULL DEFAULT 'Flat'");
        MySqlSchema.EnsureColumn(connection, "OutputBlueprints", "TreeJson", "LONGTEXT NULL");
    }

    public OutputBlueprintSummary Save(string name, string schemaKind, List<string>? fieldNames, List<OutputBlueprintTreeSchemaNode>? tree)
    {
        var savedAt = DateTimeOffset.UtcNow.ToString("O");
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO OutputBlueprints (Name, SavedAt, FieldNamesJson, SchemaKind, TreeJson)
            VALUES (@name, @savedAt, @fieldNamesJson, @schemaKind, @treeJson);
            SELECT LAST_INSERT_ID();
            """;
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@savedAt", savedAt);
        command.Parameters.AddWithValue("@fieldNamesJson", OutputBlueprintStore.SerializeFieldNames(fieldNames ?? []));
        command.Parameters.AddWithValue("@schemaKind", schemaKind);
        command.Parameters.AddWithValue("@treeJson", tree is { Count: > 0 } ? OutputBlueprintStore.SerializeTree(tree) : DBNull.Value);
        var id = Convert.ToInt64(command.ExecuteScalar());
        var fieldCount = tree is { Count: > 0 } ? OutputBlueprintStore.CountLeaves(tree) : (fieldNames?.Count ?? 0);
        return new OutputBlueprintSummary(id, name, savedAt, fieldCount, schemaKind);
    }

    public IReadOnlyList<OutputBlueprintSummary> ListAll()
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Name, SavedAt, FieldNamesJson, SchemaKind, TreeJson FROM OutputBlueprints ORDER BY Name;";

        var results = new List<OutputBlueprintSummary>();
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            var fieldCount = reader.IsDBNull(5)
                ? OutputBlueprintStore.DeserializeFieldNames(reader.GetString(3)).Count
                : OutputBlueprintStore.CountLeaves(OutputBlueprintStore.DeserializeTree(reader.GetString(5)));
            results.Add(new OutputBlueprintSummary(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), fieldCount, reader.GetString(4)));
        }
        return results;
    }

    public OutputBlueprintRecord? Get(long id)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Name, SavedAt, FieldNamesJson, SchemaKind, TreeJson FROM OutputBlueprints WHERE Id = @id;";
        command.Parameters.AddWithValue("@id", id);

        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        var tree = reader.IsDBNull(5) ? null : OutputBlueprintStore.DeserializeTree(reader.GetString(5));
        return new OutputBlueprintRecord(
            reader.GetInt64(0), reader.GetString(1), reader.GetString(2),
            OutputBlueprintStore.DeserializeFieldNames(reader.GetString(3)), reader.GetString(4), tree);
    }

    public bool Update(long id, string name, string schemaKind, List<string>? fieldNames, List<OutputBlueprintTreeSchemaNode>? tree)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE OutputBlueprints
            SET Name = @name, FieldNamesJson = @fieldNamesJson, SchemaKind = @schemaKind, TreeJson = @treeJson
            WHERE Id = @id;
            """;
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@fieldNamesJson", OutputBlueprintStore.SerializeFieldNames(fieldNames ?? []));
        command.Parameters.AddWithValue("@schemaKind", schemaKind);
        command.Parameters.AddWithValue("@treeJson", tree is { Count: > 0 } ? OutputBlueprintStore.SerializeTree(tree) : DBNull.Value);
        // MySQL reports *changed* rows by default, so an update that writes the
        // same values would look like "not found" — the connection string
        // (see StorageOptions) sets UseAffectedRows=false to get matched rows,
        // which is what the contract (false = no such id) needs.
        return command.ExecuteNonQuery() > 0;
    }

    public bool Delete(long id)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM OutputBlueprints WHERE Id = @id;";
        command.Parameters.AddWithValue("@id", id);
        return command.ExecuteNonQuery() > 0;
    }
}
