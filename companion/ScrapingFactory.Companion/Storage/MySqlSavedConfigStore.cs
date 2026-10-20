using MySqlConnector;

namespace ScrapingFactory.Companion.Storage;

// Issue #277: MySQL/MariaDB implementation of ISavedConfigStore — the same
// contract as SavedConfigStore (SQLite), see ISavedConfigStore for the notes
// every implementation has to keep. Differences from the SQLite one that are
// worth knowing: ConfigJson/Content are LONGTEXT (MySQL's TEXT would cap them
// at 64 KB), Host is a VARCHAR(255) so it can be indexed (a longer raw-string
// fallback host is truncated consistently on save and lookup), foreign keys
// are always enforced by InnoDB (no PRAGMA), and SavedAt keeps the same
// fixed-width ISO-8601 text as SQLite so "newest first" sorts identically.
public sealed class MySqlSavedConfigStore : ISavedConfigStore
{
    private const int MaxHostLength = 255;
    private readonly string _connectionString;

    public MySqlSavedConfigStore(string connectionString)
    {
        _connectionString = connectionString;
        EnsureCreated();
    }

    private static string HostOf(string url)
    {
        var host = SavedConfigStore.ComputeHost(url);
        return host.Length > MaxHostLength ? host[..MaxHostLength] : host;
    }

    private void EnsureCreated()
    {
        using var connection = MySqlSchema.Open(_connectionString);
        MySqlSchema.Execute(connection, """
            CREATE TABLE IF NOT EXISTS SavedConfigs (
                Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                Url TEXT NOT NULL,
                Host VARCHAR(255) NOT NULL,
                Name TEXT NOT NULL,
                SavedAt VARCHAR(40) NOT NULL,
                ConfigJson LONGTEXT NOT NULL,
                INDEX IX_SavedConfigs_Host (Host)
            ) CHARACTER SET utf8mb4;
            """);
        MySqlSchema.Execute(connection, """
            CREATE TABLE IF NOT EXISTS SavedOutputs (
                Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                SavedConfigId BIGINT NOT NULL,
                Name TEXT NOT NULL,
                FileName TEXT NOT NULL,
                SavedAt VARCHAR(40) NOT NULL,
                Content LONGTEXT NOT NULL,
                INDEX IX_SavedOutputs_SavedConfigId (SavedConfigId),
                CONSTRAINT FK_SavedOutputs_SavedConfigs FOREIGN KEY (SavedConfigId) REFERENCES SavedConfigs(Id) ON DELETE CASCADE
            ) CHARACTER SET utf8mb4;
            """);
        // Issue #207's column, added the same idempotent way the SQLite store does.
        MySqlSchema.EnsureColumn(connection, "SavedConfigs", "BlueprintId", "BIGINT NULL");
        // Issue #278: the owning user (0 = a companion without authentication).
        MySqlSchema.EnsureColumn(connection, "SavedConfigs", "OwnerId", "BIGINT NOT NULL DEFAULT 0");
    }

    public SavedConfigSummary Save(string url, string name, string configJson, long? blueprintId = null, long ownerId = 0)
    {
        var savedAt = DateTimeOffset.UtcNow.ToString("O");
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO SavedConfigs (Url, Host, Name, SavedAt, ConfigJson, BlueprintId, OwnerId)
            VALUES (@url, @host, @name, @savedAt, @configJson, @blueprintId, @ownerId);
            SELECT LAST_INSERT_ID();
            """;
        command.Parameters.AddWithValue("@url", url);
        command.Parameters.AddWithValue("@host", HostOf(url));
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@savedAt", savedAt);
        command.Parameters.AddWithValue("@configJson", configJson);
        command.Parameters.AddWithValue("@blueprintId", (object?)blueprintId ?? DBNull.Value);
        command.Parameters.AddWithValue("@ownerId", ownerId);
        var id = Convert.ToInt64(command.ExecuteScalar());
        return new SavedConfigSummary(id, url, name, savedAt, blueprintId);
    }

    public IReadOnlyList<SavedConfigSummary> ListByUrl(string url, long ownerId = 0)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Url, Name, SavedAt, BlueprintId FROM SavedConfigs WHERE Host = @host AND OwnerId = @ownerId ORDER BY SavedAt DESC;";
        command.Parameters.AddWithValue("@host", HostOf(url));
        command.Parameters.AddWithValue("@ownerId", ownerId);
        return ReadConfigSummaries(command);
    }

    public IReadOnlyList<SavedConfigSummary> ListAll(long ownerId = 0)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Url, Name, SavedAt, BlueprintId FROM SavedConfigs WHERE OwnerId = @ownerId ORDER BY SavedAt DESC;";
        command.Parameters.AddWithValue("@ownerId", ownerId);
        return ReadConfigSummaries(command);
    }

    private static List<SavedConfigSummary> ReadConfigSummaries(MySqlCommand command)
    {
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

    public SavedConfigRecord? Get(long id, long ownerId = 0)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Url, Name, SavedAt, ConfigJson, BlueprintId FROM SavedConfigs WHERE Id = @id AND OwnerId = @ownerId;";
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@ownerId", ownerId);
        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        return new SavedConfigRecord(
            reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4),
            reader.IsDBNull(5) ? null : reader.GetInt64(5));
    }

    public bool Delete(long id, long ownerId = 0)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM SavedConfigs WHERE Id = @id AND OwnerId = @ownerId;";
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@ownerId", ownerId);
        return command.ExecuteNonQuery() > 0;
    }

    public SavedOutputSummary SaveOutput(long savedConfigId, string name, string fileName, string content, long ownerId = 0)
    {
        var savedAt = DateTimeOffset.UtcNow.ToString("O");
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO SavedOutputs (SavedConfigId, Name, FileName, SavedAt, Content)
            SELECT Id, @name, @fileName, @savedAt, @content FROM SavedConfigs WHERE Id = @savedConfigId AND OwnerId = @ownerId;
            SELECT ROW_COUNT(), LAST_INSERT_ID();
            """;
        command.Parameters.AddWithValue("@savedConfigId", savedConfigId);
        command.Parameters.AddWithValue("@ownerId", ownerId);
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@fileName", fileName);
        command.Parameters.AddWithValue("@savedAt", savedAt);
        command.Parameters.AddWithValue("@content", content);
        // The INSERT ... SELECT only inserts for a configuration this owner owns.
        using var reader = command.ExecuteReader();
        reader.Read();
        if (reader.GetInt64(0) == 0)
            throw new KeyNotFoundException($"Saved configuration {savedConfigId} does not exist.");
        return new SavedOutputSummary(reader.GetInt64(1), savedConfigId, name, fileName, savedAt);
    }

    public IReadOnlyList<SavedOutputSummary> ListOutputsByConfigId(long savedConfigId, long ownerId = 0)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT o.Id, o.SavedConfigId, o.Name, o.FileName, o.SavedAt FROM SavedOutputs o
            JOIN SavedConfigs c ON c.Id = o.SavedConfigId
            WHERE o.SavedConfigId = @savedConfigId AND c.OwnerId = @ownerId
            ORDER BY o.SavedAt DESC;
            """;
        command.Parameters.AddWithValue("@savedConfigId", savedConfigId);
        command.Parameters.AddWithValue("@ownerId", ownerId);
        var results = new List<SavedOutputSummary>();
        using var reader = command.ExecuteReader();
        while (reader.Read()) results.Add(ReadOutputSummary(reader));
        return results;
    }

    public SavedOutputRecord? GetOutput(long id, long ownerId = 0)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT o.Id, o.SavedConfigId, o.Name, o.FileName, o.SavedAt, o.Content FROM SavedOutputs o
            JOIN SavedConfigs c ON c.Id = o.SavedConfigId
            WHERE o.Id = @id AND c.OwnerId = @ownerId;
            """;
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@ownerId", ownerId);
        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        return new SavedOutputRecord(
            reader.GetInt64(0), reader.GetInt64(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), reader.GetString(5));
    }

    public bool DeleteOutput(long id, long ownerId = 0)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM SavedOutputs WHERE Id = @id AND SavedConfigId IN (SELECT Id FROM SavedConfigs WHERE OwnerId = @ownerId);";
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@ownerId", ownerId);
        return command.ExecuteNonQuery() > 0;
    }

    public SavedOutputSummary? GetMostRecentOutputForConfig(long savedConfigId, long excludeOutputId, long ownerId = 0)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT o.Id, o.SavedConfigId, o.Name, o.FileName, o.SavedAt FROM SavedOutputs o
            JOIN SavedConfigs c ON c.Id = o.SavedConfigId
            WHERE o.SavedConfigId = @savedConfigId AND o.Id <> @excludeOutputId AND c.OwnerId = @ownerId
            ORDER BY o.SavedAt DESC
            LIMIT 1;
            """;
        command.Parameters.AddWithValue("@savedConfigId", savedConfigId);
        command.Parameters.AddWithValue("@excludeOutputId", excludeOutputId);
        command.Parameters.AddWithValue("@ownerId", ownerId);
        using var reader = command.ExecuteReader();
        return reader.Read() ? ReadOutputSummary(reader) : null;
    }

    public SavedOutputSummary? GetMostRecentOutputForBlueprint(long blueprintId, long excludeOutputId, long ownerId = 0)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT o.Id, o.SavedConfigId, o.Name, o.FileName, o.SavedAt
            FROM SavedOutputs o
            JOIN SavedConfigs c ON c.Id = o.SavedConfigId
            WHERE c.BlueprintId = @blueprintId AND o.Id <> @excludeOutputId AND c.OwnerId = @ownerId
            ORDER BY o.SavedAt DESC
            LIMIT 1;
            """;
        command.Parameters.AddWithValue("@blueprintId", blueprintId);
        command.Parameters.AddWithValue("@excludeOutputId", excludeOutputId);
        command.Parameters.AddWithValue("@ownerId", ownerId);
        using var reader = command.ExecuteReader();
        return reader.Read() ? ReadOutputSummary(reader) : null;
    }

    private static SavedOutputSummary ReadOutputSummary(MySqlDataReader reader) =>
        new(reader.GetInt64(0), reader.GetInt64(1), reader.GetString(2), reader.GetString(3), reader.GetString(4));

    public int ClaimUnowned(long ownerId)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE SavedConfigs SET OwnerId = @ownerId WHERE OwnerId = 0;";
        command.Parameters.AddWithValue("@ownerId", ownerId);
        return command.ExecuteNonQuery();
    }
}
