using Microsoft.Data.Sqlite;

namespace ScrapingFactory.Companion.Storage;

// The SQLite counterpart of MySqlSchema: every store creates its tables with the original columns and adds each later column
// through EnsureColumn, so a database file written by an older build keeps working.
internal static class SqliteSchema
{
    public static SqliteConnection Open(string connectionString)
    {
        var connection = new SqliteConnection(connectionString);
        connection.Open();
        return connection;
    }

    public static void Execute(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    public static void EnsureColumn(SqliteConnection connection, string table, string column, string definition)
    {
        using (var check = connection.CreateCommand())
        {
            check.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = @name;";
            check.Parameters.AddWithValue("@name", column);
            if ((long)check.ExecuteScalar()! > 0)
                return;
        }

        Execute(connection, $"ALTER TABLE {table} ADD COLUMN {column} {definition};");
    }
}
