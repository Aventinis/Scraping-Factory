using MySqlConnector;
using ScrapingFactory.Companion.Storage;

namespace ScrapingFactory.Companion.Auth;

// Issue #278: MySQL/MariaDB implementation of IUserStore — the Users table
// lives in the same database as the other stores (Issue #277), which is what
// makes a shared server's users and their data one thing.
public sealed class MySqlUserStore : IUserStore
{
    private readonly string _connectionString;

    public MySqlUserStore(string connectionString)
    {
        _connectionString = connectionString;
        using var connection = MySqlSchema.Open(_connectionString);
        MySqlSchema.Execute(connection, """
            CREATE TABLE IF NOT EXISTS Users (
                Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                Name VARCHAR(64) NOT NULL,
                KeyHash CHAR(64) NOT NULL,
                CreatedAt VARCHAR(40) NOT NULL,
                UNIQUE KEY UX_Users_Name (Name),
                UNIQUE KEY UX_Users_KeyHash (KeyHash)
            ) CHARACTER SET utf8mb4;
            """);
    }

    public (UserRecord User, string Key) Create(string name)
    {
        var key = ApiKeys.Generate();
        var createdAt = DateTimeOffset.UtcNow.ToString("O");
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO Users (Name, KeyHash, CreatedAt) VALUES (@name, @hash, @createdAt); SELECT LAST_INSERT_ID();";
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@hash", ApiKeys.Hash(key));
        command.Parameters.AddWithValue("@createdAt", createdAt);
        try
        {
            return (new UserRecord(Convert.ToInt64(command.ExecuteScalar()), name, createdAt), key);
        }
        catch (MySqlException exception) when (exception.ErrorCode == MySqlErrorCode.DuplicateKeyEntry)
        {
            throw new InvalidOperationException($"A user named '{name}' already exists.");
        }
    }

    private static UserRecord Read(MySqlDataReader reader) => new(reader.GetInt64(0), reader.GetString(1), reader.GetString(2));

    public UserRecord? FindByKey(string key)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Name, CreatedAt FROM Users WHERE KeyHash = @hash;";
        command.Parameters.AddWithValue("@hash", ApiKeys.Hash(key));
        using var reader = command.ExecuteReader();
        return reader.Read() ? Read(reader) : null;
    }

    public UserRecord? FindByName(string name)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Name, CreatedAt FROM Users WHERE Name = @name;";
        command.Parameters.AddWithValue("@name", name);
        using var reader = command.ExecuteReader();
        return reader.Read() ? Read(reader) : null;
    }

    public IReadOnlyList<UserRecord> List()
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Name, CreatedAt FROM Users ORDER BY Name;";
        var results = new List<UserRecord>();
        using var reader = command.ExecuteReader();
        while (reader.Read()) results.Add(Read(reader));
        return results;
    }

    public bool Remove(string name)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM Users WHERE Name = @name;";
        command.Parameters.AddWithValue("@name", name);
        return command.ExecuteNonQuery() > 0;
    }

    public string? RotateKey(string name)
    {
        var key = ApiKeys.Generate();
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE Users SET KeyHash = @hash WHERE Name = @name;";
        command.Parameters.AddWithValue("@hash", ApiKeys.Hash(key));
        command.Parameters.AddWithValue("@name", name);
        return command.ExecuteNonQuery() > 0 ? key : null;
    }
}
