using System.Data.Common;

namespace ScrapingFactory.Companion.Storage;

// Shared plumbing of the SQL-backed stores. Each store is written once against System.Data.Common in an abstract base
// (SqlUserStoreBase, SqlSavedConfigStoreBase, ...); the SQLite and MySQL classes only add their DDL and the few dialect hooks
// (see docs/design-notes/companion.md, "Store dialects").
public abstract class SqlStore
{
    protected abstract DbConnection OpenConnection();

    // SQL returning the id the last INSERT on the same connection generated.
    protected abstract string LastInsertIdSql { get; }

    // Parameters are (name, value) pairs; a null value is sent as NULL.
    protected static int Execute(DbConnection connection, string sql, params (string Name, object? Value)[] args)
    {
        using var command = CreateCommand(connection, sql, args);
        return command.ExecuteNonQuery();
    }

    protected static object? Scalar(DbConnection connection, string sql, params (string Name, object? Value)[] args)
    {
        using var command = CreateCommand(connection, sql, args);
        return command.ExecuteScalar();
    }

    protected static long Count(DbConnection connection, string sql, params (string Name, object? Value)[] args) =>
        Convert.ToInt64(Scalar(connection, sql, args));

    protected static List<T> Query<T>(DbConnection connection, string sql, Func<DbDataReader, T> map, params (string Name, object? Value)[] args)
    {
        using var command = CreateCommand(connection, sql, args);
        using var reader = command.ExecuteReader();
        var results = new List<T>();
        while (reader.Read())
            results.Add(map(reader));
        return results;
    }

    protected static T? QueryFirst<T>(DbConnection connection, string sql, Func<DbDataReader, T> map, params (string Name, object? Value)[] args)
    {
        using var command = CreateCommand(connection, sql, args);
        using var reader = command.ExecuteReader();
        return reader.Read() ? map(reader) : default;
    }

    protected long Insert(DbConnection connection, string sql, params (string Name, object? Value)[] args)
    {
        Execute(connection, sql, args);
        return Convert.ToInt64(Scalar(connection, LastInsertIdSql));
    }

    protected static long? NullableInt64(DbDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : reader.GetInt64(ordinal);

    // Integers and flags come back as different CLR types per driver (TINYINT(1) is a bool in MySqlConnector).
    protected static long ToInt64(DbDataReader reader, int ordinal) => Convert.ToInt64(reader.GetValue(ordinal));

    private static DbCommand CreateCommand(DbConnection connection, string sql, (string Name, object? Value)[] args)
    {
        var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in args)
        {
            var parameter = command.CreateParameter();
            parameter.ParameterName = name;
            parameter.Value = value ?? DBNull.Value;
            command.Parameters.Add(parameter);
        }
        return command;
    }
}
