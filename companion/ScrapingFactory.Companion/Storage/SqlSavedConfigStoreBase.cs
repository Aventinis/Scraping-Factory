using System.Data.Common;

namespace ScrapingFactory.Companion.Storage;

// ISavedConfigStore written once for both databases; SavedConfigStore (SQLite) and MySqlSavedConfigStore add the tables and
// the dialect hooks. The contract notes are on ISavedConfigStore.
public abstract class SqlSavedConfigStoreBase : SqlStore, ISavedConfigStore
{
    private const string ConfigSummaryColumns = "Id, Url, Name, SavedAt, BlueprintId";
    private const string OutputSummaryColumns = "o.Id, o.SavedConfigId, o.Name, o.FileName, o.SavedAt";

    // A saved url may not be a well-formed absolute URI (a hand-edited export); the raw string is then used consistently on
    // save and lookup.
    internal static string ComputeHost(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) ? uri.Host : url;

    // The value stored in (and looked up by) the Host column.
    protected virtual string HostOf(string url) => ComputeHost(url);

    private static SavedConfigSummary ReadConfigSummary(DbDataReader reader) =>
        new(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), NullableInt64(reader, 4));

    private static SavedOutputSummary ReadOutputSummary(DbDataReader reader) =>
        new(reader.GetInt64(0), reader.GetInt64(1), reader.GetString(2), reader.GetString(3), reader.GetString(4));

    public SavedConfigSummary Save(string url, string name, string configJson, long? blueprintId = null, long ownerId = 0)
    {
        var savedAt = DateTimeOffset.UtcNow.ToString("O");
        using var connection = OpenConnection();
        var id = Insert(connection,
            "INSERT INTO SavedConfigs (Url, Host, Name, SavedAt, ConfigJson, BlueprintId, OwnerId) VALUES (@url, @host, @name, @savedAt, @configJson, @blueprintId, @ownerId);",
            ("@url", url), ("@host", HostOf(url)), ("@name", name), ("@savedAt", savedAt), ("@configJson", configJson),
            ("@blueprintId", blueprintId), ("@ownerId", ownerId));
        return new SavedConfigSummary(id, url, name, savedAt, blueprintId);
    }

    public IReadOnlyList<SavedConfigSummary> ListByUrl(string url, long ownerId = 0)
    {
        using var connection = OpenConnection();
        return Query(connection,
            $"SELECT {ConfigSummaryColumns} FROM SavedConfigs WHERE Host = @host AND OwnerId = @ownerId ORDER BY SavedAt DESC;",
            ReadConfigSummary, ("@host", HostOf(url)), ("@ownerId", ownerId));
    }

    public IReadOnlyList<SavedConfigSummary> ListAll(long ownerId = 0)
    {
        using var connection = OpenConnection();
        return Query(connection,
            $"SELECT {ConfigSummaryColumns} FROM SavedConfigs WHERE OwnerId = @ownerId ORDER BY SavedAt DESC;",
            ReadConfigSummary, ("@ownerId", ownerId));
    }

    public SavedConfigRecord? Get(long id, long ownerId = 0)
    {
        using var connection = OpenConnection();
        return QueryFirst(connection,
            "SELECT Id, Url, Name, SavedAt, ConfigJson, BlueprintId FROM SavedConfigs WHERE Id = @id AND OwnerId = @ownerId;",
            reader => new SavedConfigRecord(
                reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), NullableInt64(reader, 5)),
            ("@id", id), ("@ownerId", ownerId));
    }

    public bool Delete(long id, long ownerId = 0)
    {
        using var connection = OpenConnection();
        return Execute(connection, "DELETE FROM SavedConfigs WHERE Id = @id AND OwnerId = @ownerId;", ("@id", id), ("@ownerId", ownerId)) > 0;
    }

    // The INSERT ... SELECT only inserts for a configuration this owner owns; no row means no such configuration.
    public SavedOutputSummary SaveOutput(long savedConfigId, string name, string fileName, string content, long ownerId = 0)
    {
        var savedAt = DateTimeOffset.UtcNow.ToString("O");
        using var connection = OpenConnection();
        var inserted = Execute(connection,
            "INSERT INTO SavedOutputs (SavedConfigId, Name, FileName, SavedAt, Content) SELECT Id, @name, @fileName, @savedAt, @content FROM SavedConfigs WHERE Id = @savedConfigId AND OwnerId = @ownerId;",
            ("@savedConfigId", savedConfigId), ("@ownerId", ownerId), ("@name", name), ("@fileName", fileName), ("@savedAt", savedAt), ("@content", content));
        if (inserted == 0)
            throw new KeyNotFoundException($"Saved configuration {savedConfigId} does not exist.");
        return new SavedOutputSummary(LastInsertId(connection), savedConfigId, name, fileName, savedAt);
    }

    public IReadOnlyList<SavedOutputSummary> ListOutputsByConfigId(long savedConfigId, long ownerId = 0)
    {
        using var connection = OpenConnection();
        return Query(connection,
            $"SELECT {OutputSummaryColumns} FROM SavedOutputs o JOIN SavedConfigs c ON c.Id = o.SavedConfigId WHERE o.SavedConfigId = @savedConfigId AND c.OwnerId = @ownerId ORDER BY o.SavedAt DESC;",
            ReadOutputSummary, ("@savedConfigId", savedConfigId), ("@ownerId", ownerId));
    }

    public SavedOutputRecord? GetOutput(long id, long ownerId = 0)
    {
        using var connection = OpenConnection();
        return QueryFirst(connection,
            "SELECT o.Id, o.SavedConfigId, o.Name, o.FileName, o.SavedAt, o.Content FROM SavedOutputs o JOIN SavedConfigs c ON c.Id = o.SavedConfigId WHERE o.Id = @id AND c.OwnerId = @ownerId;",
            reader => new SavedOutputRecord(
                reader.GetInt64(0), reader.GetInt64(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), reader.GetString(5)),
            ("@id", id), ("@ownerId", ownerId));
    }

    public bool DeleteOutput(long id, long ownerId = 0)
    {
        using var connection = OpenConnection();
        return Execute(connection,
            "DELETE FROM SavedOutputs WHERE Id = @id AND SavedConfigId IN (SELECT Id FROM SavedConfigs WHERE OwnerId = @ownerId);",
            ("@id", id), ("@ownerId", ownerId)) > 0;
    }

    public SavedOutputSummary? GetMostRecentOutputForConfig(long savedConfigId, long excludeOutputId, long ownerId = 0)
    {
        using var connection = OpenConnection();
        return QueryFirst(connection,
            $"SELECT {OutputSummaryColumns} FROM SavedOutputs o JOIN SavedConfigs c ON c.Id = o.SavedConfigId WHERE o.SavedConfigId = @savedConfigId AND o.Id <> @excludeOutputId AND c.OwnerId = @ownerId ORDER BY o.SavedAt DESC LIMIT 1;",
            ReadOutputSummary, ("@savedConfigId", savedConfigId), ("@excludeOutputId", excludeOutputId), ("@ownerId", ownerId));
    }

    public SavedOutputSummary? GetMostRecentOutputForBlueprint(long blueprintId, long excludeOutputId, long ownerId = 0)
    {
        using var connection = OpenConnection();
        return QueryFirst(connection,
            $"SELECT {OutputSummaryColumns} FROM SavedOutputs o JOIN SavedConfigs c ON c.Id = o.SavedConfigId WHERE c.BlueprintId = @blueprintId AND o.Id <> @excludeOutputId AND c.OwnerId = @ownerId ORDER BY o.SavedAt DESC LIMIT 1;",
            ReadOutputSummary, ("@blueprintId", blueprintId), ("@excludeOutputId", excludeOutputId), ("@ownerId", ownerId));
    }

    public int ClaimUnowned(long ownerId)
    {
        using var connection = OpenConnection();
        return Execute(connection, "UPDATE SavedConfigs SET OwnerId = @ownerId WHERE OwnerId = 0;", ("@ownerId", ownerId));
    }
}
