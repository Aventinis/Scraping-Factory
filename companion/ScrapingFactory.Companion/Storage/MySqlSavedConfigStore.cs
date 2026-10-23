using System.Data.Common;

namespace ScrapingFactory.Companion.Storage;

// MySQL/MariaDB backend of ISavedConfigStore; the queries are in SqlSavedConfigStoreBase. ConfigJson/Content are LONGTEXT
// (TEXT would cap them at 64 KB), Host is a VARCHAR(255) so it can be indexed (a longer raw-string host is truncated on save
// and lookup alike), and InnoDB always enforces the foreign key.
public sealed class MySqlSavedConfigStore : SqlSavedConfigStoreBase
{
    private const int MaxHostLength = 255;
    private readonly string _connectionString;

    public MySqlSavedConfigStore(string connectionString)
    {
        _connectionString = connectionString;
        EnsureCreated();
    }

    protected override DbConnection OpenConnection() => MySqlSchema.Open(_connectionString);

    protected override string LastInsertIdSql => "SELECT LAST_INSERT_ID();";

    protected override string HostOf(string url)
    {
        var host = ComputeHost(url);
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
        MySqlSchema.EnsureColumn(connection, "SavedConfigs", "BlueprintId", "BIGINT NULL");
        MySqlSchema.EnsureColumn(connection, "SavedConfigs", "OwnerId", "BIGINT NOT NULL DEFAULT 0");
    }
}
