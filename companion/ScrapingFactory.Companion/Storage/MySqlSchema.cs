using MySqlConnector;

namespace ScrapingFactory.Companion.Storage;

// Issue #277: the MySQL counterpart of the SQLite stores' idempotent
// "AddColumnIfMissing" migrations — each store creates its tables with the
// original columns and then adds every column that was introduced later
// through EnsureColumn, so a database created by an older build of this
// companion keeps working when it is started against a newer one.
internal static class MySqlSchema
{
    public static MySqlConnection Open(string connectionString)
    {
        var connection = new MySqlConnection(connectionString);
        connection.Open();
        return connection;
    }

    public static void Execute(MySqlConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    public static void EnsureColumn(MySqlConnection connection, string table, string column, string definition)
    {
        using (var check = connection.CreateCommand())
        {
            check.CommandText =
                "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = @table AND column_name = @column;";
            check.Parameters.AddWithValue("@table", table);
            check.Parameters.AddWithValue("@column", column);
            if (Convert.ToInt64(check.ExecuteScalar()) > 0)
                return;
        }

        Execute(connection, $"ALTER TABLE {table} ADD COLUMN {column} {definition};");
    }

    // Adds an index (given as its full `UNIQUE KEY name (cols)` / `KEY name (cols)` definition) unless it exists.
    public static void EnsureIndex(MySqlConnection connection, string table, string indexName, string definition)
    {
        using (var check = connection.CreateCommand())
        {
            check.CommandText =
                "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = @table AND index_name = @index;";
            check.Parameters.AddWithValue("@table", table);
            check.Parameters.AddWithValue("@index", indexName);
            if (Convert.ToInt64(check.ExecuteScalar()) > 0)
                return;
        }

        Execute(connection, $"ALTER TABLE {table} ADD {definition};");
    }
}
