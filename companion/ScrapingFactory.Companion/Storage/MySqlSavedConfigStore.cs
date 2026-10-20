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
    }

    public SavedConfigSummary Save(string url, string name, string configJson, long? blueprintId = null)
    {
        var savedAt = DateTimeOffset.UtcNow.ToString("O");
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO SavedConfigs (Url, Host, Name, SavedAt, ConfigJson, BlueprintId)
            VALUES (@url, @host, @name, @savedAt, @configJson, @blueprintId);
            SELECT LAST_INSERT_ID();
            """;
        command.Parameters.AddWithValue("@url", url);
        command.Parameters.AddWithValue("@host", HostOf(url));
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@savedAt", savedAt);
        command.Parameters.AddWithValue("@configJson", configJson);
        command.Parameters.AddWithValue("@blueprintId", (object?)blueprintId ?? DBNull.Value);
        var id = Convert.ToInt64(command.ExecuteScalar());
        return new SavedConfigSummary(id, url, name, savedAt, blueprintId);
    }

    public IReadOnlyList<SavedConfigSummary> ListByUrl(string url)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Url, Name, SavedAt, BlueprintId FROM SavedConfigs WHERE Host = @host ORDER BY SavedAt DESC;";
        command.Parameters.AddWithValue("@host", HostOf(url));
        return ReadConfigSummaries(command);
    }

    public IReadOnlyList<SavedConfigSummary> ListAll()
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Url, Name, SavedAt, BlueprintId FROM SavedConfigs ORDER BY SavedAt DESC;";
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

    public SavedConfigRecord? Get(long id)
    {
        using var connection = MySqlSchema.Open(_connectionString);
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
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM SavedConfigs WHERE Id = @id;";
        command.Parameters.AddWithValue("@id", id);
        return command.ExecuteNonQuery() > 0;
    }

    public SavedOutputSummary SaveOutput(long savedConfigId, string name, string fileName, string content)
    {
        var savedAt = DateTimeOffset.UtcNow.ToString("O");
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO SavedOutputs (SavedConfigId, Name, FileName, SavedAt, Content)
            VALUES (@savedConfigId, @name, @fileName, @savedAt, @content);
            SELECT LAST_INSERT_ID();
            """;
        command.Parameters.AddWithValue("@savedConfigId", savedConfigId);
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@fileName", fileName);
        command.Parameters.AddWithValue("@savedAt", savedAt);
        command.Parameters.AddWithValue("@content", content);
        var id = Convert.ToInt64(command.ExecuteScalar());
        return new SavedOutputSummary(id, savedConfigId, name, fileName, savedAt);
    }

    public IReadOnlyList<SavedOutputSummary> ListOutputsByConfigId(long savedConfigId)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT Id, SavedConfigId, Name, FileName, SavedAt FROM SavedOutputs
            WHERE SavedConfigId = @savedConfigId
            ORDER BY SavedAt DESC;
            """;
        command.Parameters.AddWithValue("@savedConfigId", savedConfigId);
        var results = new List<SavedOutputSummary>();
        using var reader = command.ExecuteReader();
        while (reader.Read()) results.Add(ReadOutputSummary(reader));
        return results;
    }

    public SavedOutputRecord? GetOutput(long id)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, SavedConfigId, Name, FileName, SavedAt, Content FROM SavedOutputs WHERE Id = @id;";
        command.Parameters.AddWithValue("@id", id);
        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        return new SavedOutputRecord(
            reader.GetInt64(0), reader.GetInt64(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), reader.GetString(5));
    }

    public bool DeleteOutput(long id)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM SavedOutputs WHERE Id = @id;";
        command.Parameters.AddWithValue("@id", id);
        return command.ExecuteNonQuery() > 0;
    }

    public SavedOutputSummary? GetMostRecentOutputForConfig(long savedConfigId, long excludeOutputId)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT Id, SavedConfigId, Name, FileName, SavedAt FROM SavedOutputs
            WHERE SavedConfigId = @savedConfigId AND Id <> @excludeOutputId
            ORDER BY SavedAt DESC
            LIMIT 1;
            """;
        command.Parameters.AddWithValue("@savedConfigId", savedConfigId);
        command.Parameters.AddWithValue("@excludeOutputId", excludeOutputId);
        using var reader = command.ExecuteReader();
        return reader.Read() ? ReadOutputSummary(reader) : null;
    }

    public SavedOutputSummary? GetMostRecentOutputForBlueprint(long blueprintId, long excludeOutputId)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT o.Id, o.SavedConfigId, o.Name, o.FileName, o.SavedAt
            FROM SavedOutputs o
            JOIN SavedConfigs c ON c.Id = o.SavedConfigId
            WHERE c.BlueprintId = @blueprintId AND o.Id <> @excludeOutputId
            ORDER BY o.SavedAt DESC
            LIMIT 1;
            """;
        command.Parameters.AddWithValue("@blueprintId", blueprintId);
        command.Parameters.AddWithValue("@excludeOutputId", excludeOutputId);
        using var reader = command.ExecuteReader();
        return reader.Read() ? ReadOutputSummary(reader) : null;
    }

    private static SavedOutputSummary ReadOutputSummary(MySqlDataReader reader) =>
        new(reader.GetInt64(0), reader.GetInt64(1), reader.GetString(2), reader.GetString(3), reader.GetString(4));
}
