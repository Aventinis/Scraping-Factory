using MySqlConnector;
using ScrapingFactory.Companion.Storage;

namespace ScrapingFactory.Companion.Auth;

// Issue #278: MySQL/MariaDB implementation of IUserStore — the Users table
// lives in the same database as the other stores (Issue #277), which is what
// makes a shared server's users and their data one thing.
// Issue #352: PasswordHash/Disabled columns (added through EnsureColumn, like
// every later column) and a Tokens table for per-device login tokens.
public sealed class MySqlUserStore : IUserStore
{
    private const string UserColumns = "Id, Name, CreatedAt, PasswordHash IS NOT NULL, Disabled";
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
        MySqlSchema.EnsureColumn(connection, "Users", "PasswordHash", "VARCHAR(255) NULL");
        MySqlSchema.EnsureColumn(connection, "Users", "Disabled", "TINYINT(1) NOT NULL DEFAULT 0");
        MySqlSchema.Execute(connection, """
            CREATE TABLE IF NOT EXISTS Tokens (
                Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                UserId BIGINT NOT NULL,
                TokenHash CHAR(64) NOT NULL,
                Label VARCHAR(100) NOT NULL,
                CreatedAt VARCHAR(40) NOT NULL,
                UNIQUE KEY UX_Tokens_TokenHash (TokenHash),
                KEY IX_Tokens_UserId (UserId)
            ) CHARACTER SET utf8mb4;
            """);
    }

    public (UserRecord User, string Key) Create(string name)
    {
        var key = ApiKeys.Generate();
        return (Insert(name, key, passwordHash: null), key);
    }

    public UserRecord CreateWithPassword(string name, string passwordHash) =>
        Insert(name, ApiKeys.Generate(), passwordHash);

    private UserRecord Insert(string name, string key, string? passwordHash)
    {
        var createdAt = DateTimeOffset.UtcNow.ToString("O");
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO Users (Name, KeyHash, CreatedAt, PasswordHash) VALUES (@name, @hash, @createdAt, @password); SELECT LAST_INSERT_ID();";
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@hash", ApiKeys.Hash(key));
        command.Parameters.AddWithValue("@createdAt", createdAt);
        command.Parameters.AddWithValue("@password", (object?)passwordHash ?? DBNull.Value);
        try
        {
            return new UserRecord(Convert.ToInt64(command.ExecuteScalar()), name, createdAt, passwordHash is not null);
        }
        catch (MySqlException exception) when (exception.ErrorCode == MySqlErrorCode.DuplicateKeyEntry)
        {
            throw new InvalidOperationException($"A user named '{name}' already exists.");
        }
    }

    private static UserRecord Read(MySqlDataReader reader) =>
        new(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), Convert.ToInt64(reader.GetValue(3)) != 0, Convert.ToInt64(reader.GetValue(4)) != 0);

    public UserRecord? FindByKey(string key)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT {UserColumns} FROM Users WHERE Disabled = 0 AND (
                KeyHash = @hash OR Id IN (SELECT UserId FROM Tokens WHERE TokenHash = @hash));
            """;
        command.Parameters.AddWithValue("@hash", ApiKeys.Hash(key));
        using var reader = command.ExecuteReader();
        return reader.Read() ? Read(reader) : null;
    }

    public UserRecord? FindByName(string name)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {UserColumns} FROM Users WHERE Name = @name;";
        command.Parameters.AddWithValue("@name", name);
        using var reader = command.ExecuteReader();
        return reader.Read() ? Read(reader) : null;
    }

    public IReadOnlyList<UserRecord> List()
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {UserColumns} FROM Users ORDER BY Name;";
        var results = new List<UserRecord>();
        using var reader = command.ExecuteReader();
        while (reader.Read()) results.Add(Read(reader));
        return results;
    }

    public bool Remove(string name)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using (var tokens = connection.CreateCommand())
        {
            tokens.CommandText = "DELETE FROM Tokens WHERE UserId IN (SELECT Id FROM Users WHERE Name = @name);";
            tokens.Parameters.AddWithValue("@name", name);
            tokens.ExecuteNonQuery();
        }
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

    public string? GetPasswordHash(string name)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT PasswordHash FROM Users WHERE Name = @name;";
        command.Parameters.AddWithValue("@name", name);
        var value = command.ExecuteScalar();
        return value is string hash ? hash : null;
    }

    public bool SetPassword(string name, string passwordHash)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE Users SET PasswordHash = @password WHERE Name = @name;";
        command.Parameters.AddWithValue("@password", passwordHash);
        command.Parameters.AddWithValue("@name", name);
        // Matched rows (UseAffectedRows=false, see StorageOptions), so setting the same hash still reports true.
        return command.ExecuteNonQuery() > 0;
    }

    public bool SetDisabled(string name, bool disabled)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE Users SET Disabled = @disabled WHERE Name = @name;";
        command.Parameters.AddWithValue("@disabled", disabled ? 1 : 0);
        command.Parameters.AddWithValue("@name", name);
        return command.ExecuteNonQuery() > 0;
    }

    public string CreateToken(long userId, string label)
    {
        var token = ApiKeys.Generate();
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO Tokens (UserId, TokenHash, Label, CreatedAt) VALUES (@user, @hash, @label, @createdAt);";
        command.Parameters.AddWithValue("@user", userId);
        command.Parameters.AddWithValue("@hash", ApiKeys.Hash(token));
        command.Parameters.AddWithValue("@label", label);
        command.Parameters.AddWithValue("@createdAt", DateTimeOffset.UtcNow.ToString("O"));
        command.ExecuteNonQuery();
        return token;
    }

    public bool RevokeToken(string token)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM Tokens WHERE TokenHash = @hash;";
        command.Parameters.AddWithValue("@hash", ApiKeys.Hash(token));
        return command.ExecuteNonQuery() > 0;
    }

    public int RevokeTokens(long userId, string? exceptToken = null)
    {
        using var connection = MySqlSchema.Open(_connectionString);
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM Tokens WHERE UserId = @user AND (@except IS NULL OR TokenHash <> @except);";
        command.Parameters.AddWithValue("@user", userId);
        command.Parameters.AddWithValue("@except", exceptToken is null ? DBNull.Value : ApiKeys.Hash(exceptToken));
        return command.ExecuteNonQuery();
    }
}
