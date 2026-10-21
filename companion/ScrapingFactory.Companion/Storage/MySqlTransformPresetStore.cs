using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Companion.Storage;

// Issue #277: MySQL/MariaDB implementation of ITransformPresetStore — same
// contract and JSON shape as TransformPresetStore (SQLite). Name uniqueness is
// compared as LOWER(...) under a binary collation, i.e. case-insensitive but
// accent-sensitive exactly like SQLite's COLLATE NOCASE (the server's default
// utf8mb4 collations would also treat "é" and "e" as equal).
public sealed class MySqlTransformPresetStore : ITransformPresetStore
{
    private readonly string _connectionString;

    public MySqlTransformPresetStore(string connectionString)
    {
        _connectionString = connectionString;
        EnsureCreated();
    }

    private void EnsureCreated()
    {
        using var connection = MySqlSchema.Open(_connectionString);
        MySqlSchema.Execute(connection, """
            CREATE TABLE IF NOT EXISTS TransformPresets (
                Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                Name TEXT NOT NULL,
                SavedAt VARCHAR(40) NOT NULL,
                TransformsJson LONGTEXT NOT NULL
            ) CHARACTER SET utf8mb4;
            """);
        // Issue #278: the owning user (0 = a companion without authentication).
        MySqlSchema.EnsureColumn(connection, "TransformPresets", "OwnerId", "BIGINT NOT NULL DEFAULT 0");
    }

    public TransformPresetSummary Save(string name, List<FieldTransform> transforms, long ownerId = 0)
    {
        var savedAt = DateTimeOffset.UtcNow.ToString("O");
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO TransformPresets (Name, SavedAt, TransformsJson, OwnerId) VALUES (@name, @savedAt, @transformsJson, @ownerId);
            SELECT LAST_INSERT_ID();
            """;
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@savedAt", savedAt);
        command.Parameters.AddWithValue("@transformsJson", TransformPresetStore.Serialize(transforms));
        command.Parameters.AddWithValue("@ownerId", ownerId);
        var id = Convert.ToInt64(command.ExecuteScalar());
        return new TransformPresetSummary(id, name, savedAt, transforms);
    }

    public IReadOnlyList<TransformPresetSummary> ListAll(long ownerId = 0)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Name, SavedAt, TransformsJson FROM TransformPresets WHERE OwnerId = @ownerId ORDER BY Name;";
        command.Parameters.AddWithValue("@ownerId", ownerId);

        var results = new List<TransformPresetSummary>();
        using var reader = command.ExecuteReader();
        while (reader.Read())
            results.Add(new TransformPresetSummary(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), TransformPresetStore.Deserialize(reader.GetString(3))));
        return results;
    }

    public bool Exists(long id, long ownerId = 0)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM TransformPresets WHERE Id = @id AND OwnerId = @ownerId;";
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@ownerId", ownerId);
        return Convert.ToInt64(command.ExecuteScalar()) > 0;
    }

    public bool NameTaken(string name, long? exceptId = null, long ownerId = 0)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT COUNT(*) FROM TransformPresets
            WHERE LOWER(Name) COLLATE utf8mb4_bin = LOWER(@name) COLLATE utf8mb4_bin
              AND OwnerId = @ownerId
              AND (@exceptId IS NULL OR Id <> @exceptId);
            """;
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@ownerId", ownerId);
        command.Parameters.AddWithValue("@exceptId", exceptId.HasValue ? exceptId.Value : DBNull.Value);
        return Convert.ToInt64(command.ExecuteScalar()) > 0;
    }

    public bool Rename(long id, string name, long ownerId = 0)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE TransformPresets SET Name = @name WHERE Id = @id AND OwnerId = @ownerId;";
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@ownerId", ownerId);
        command.Parameters.AddWithValue("@name", name);
        return command.ExecuteNonQuery() > 0;
    }

    public bool Delete(long id, long ownerId = 0)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM TransformPresets WHERE Id = @id AND OwnerId = @ownerId;";
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@ownerId", ownerId);
        return command.ExecuteNonQuery() > 0;
    }

    public int ClaimUnowned(long ownerId)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE TransformPresets SET OwnerId = @ownerId WHERE OwnerId = 0;";
        command.Parameters.AddWithValue("@ownerId", ownerId);
        return command.ExecuteNonQuery();
    }
}
