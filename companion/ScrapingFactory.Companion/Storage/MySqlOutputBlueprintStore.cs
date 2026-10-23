using System.Data.Common;

namespace ScrapingFactory.Companion.Storage;

// MySQL/MariaDB backend of IOutputBlueprintStore; the queries are in SqlOutputBlueprintStoreBase. Names sort
// case-insensitively because the utf8mb4 default collation is.
public sealed class MySqlOutputBlueprintStore : SqlOutputBlueprintStoreBase
{
    private readonly string _connectionString;

    public MySqlOutputBlueprintStore(string connectionString)
    {
        _connectionString = connectionString;
        EnsureCreated();
    }

    protected override DbConnection OpenConnection() => MySqlSchema.Open(_connectionString);

    protected override string LastInsertIdSql => "SELECT LAST_INSERT_ID();";

    protected override string NameOrderBy => "Name";

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
        MySqlSchema.EnsureColumn(connection, "OutputBlueprints", "SchemaKind", "VARCHAR(16) NOT NULL DEFAULT 'Flat'");
        MySqlSchema.EnsureColumn(connection, "OutputBlueprints", "TreeJson", "LONGTEXT NULL");
        MySqlSchema.EnsureColumn(connection, "OutputBlueprints", "OwnerId", "BIGINT NOT NULL DEFAULT 0");
    }
}
