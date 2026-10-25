using System.Data.Common;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using ScrapingFactory.Companion.Storage;

namespace ScrapingFactory.Companion;

// A saved scraper configuration. Host (derived from Url) lets "configs for this site" match by hostname; ConfigJson is
// stored and returned verbatim, never parsed into ScrapingConfig (BlueprintId, derived by the endpoint at save time, is
// the one exception: it makes "outputs sharing a blueprint" a SQL join).
public sealed record SavedConfigSummary(long Id, string Url, string Name, string SavedAt, long? BlueprintId = null);

public sealed record SavedConfigRecord(long Id, string Url, string Name, string SavedAt, string ConfigJson, long? BlueprintId = null);

// A saved run output linked to a configuration; Content is /generate's outputFile.content, stored verbatim.
public sealed record SavedOutputSummary(long Id, long SavedConfigId, string Name, string FileName, string SavedAt);

public sealed record SavedOutputRecord(
    long Id, long SavedConfigId, string Name, string FileName, string SavedAt, string Content);

// SQLite backend of ISavedConfigStore (saved-configs.db, Companion:SavedConfigsDbPath). The queries are in
// SqlSavedConfigStoreBase.
public sealed class SavedConfigStore : SqlSavedConfigStoreBase
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

    // Unset in normal use: the file then lives in the per-user app-data directory, not the working directory.
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

    // SQLite has foreign keys off per connection, which would skip SavedOutputs' ON DELETE CASCADE.
    protected override DbConnection OpenConnection()
    {
        var connection = SqliteSchema.Open(_connectionString);
        SqliteSchema.Execute(connection, "PRAGMA foreign_keys = ON;");
        return connection;
    }

    protected override string LastInsertIdSql => "SELECT last_insert_rowid();";

    private void EnsureCreated()
    {
        using var connection = SqliteSchema.Open(_connectionString);
        SqliteSchema.Execute(connection, """
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
            """);
        SqliteSchema.EnsureColumn(connection, "SavedConfigs", "BlueprintId", "INTEGER NULL");
        // 0 = saved without authentication; outputs are scoped through their configuration.
        SqliteSchema.EnsureColumn(connection, "SavedConfigs", "OwnerId", "INTEGER NOT NULL DEFAULT 0");
    }
}
