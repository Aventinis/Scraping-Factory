using System.Data.Common;

namespace ScrapingFactory.Companion.Storage;

// MySQL/MariaDB backend of ITransformPresetStore; the queries are in SqlTransformPresetStoreBase. Name uniqueness is
// LOWER(...) under a binary collation: case-insensitive but accent-sensitive like SQLite's NOCASE (the default utf8mb4
// collations would also equate "é" and "e").
public sealed class MySqlTransformPresetStore : SqlTransformPresetStoreBase
{
    private readonly string _connectionString;

    public MySqlTransformPresetStore(string connectionString)
    {
        _connectionString = connectionString;
        EnsureCreated();
    }

    protected override DbConnection OpenConnection() => MySqlSchema.Open(_connectionString);

    protected override string LastInsertIdSql => "SELECT LAST_INSERT_ID();";

    protected override string NameEqualsSql => "LOWER(Name) COLLATE utf8mb4_bin = LOWER(@name) COLLATE utf8mb4_bin";

    protected override string NameOrderBy => "Name";

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
        MySqlSchema.EnsureColumn(connection, "TransformPresets", "OwnerId", "BIGINT NOT NULL DEFAULT 0");
    }
}
