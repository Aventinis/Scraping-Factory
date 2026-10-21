using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;

namespace ScrapingFactory.Companion.Auth;

// Issue #278: SQLite implementation of IUserStore — its own small file
// (users.db, Companion:UsersDbPath), like every other local store.
// Issue #352: PasswordHash/Disabled columns (idempotent migration) and a Tokens
// table for per-device login tokens.
public sealed class SqliteUserStore : IUserStore
{
    private const string UserColumns = "Id, Name, CreatedAt, PasswordHash IS NOT NULL, Disabled";
    private readonly string _connectionString;

    public SqliteUserStore(IConfiguration configuration) : this(ResolveDbPath(configuration)) { }

    public SqliteUserStore(string dbPath)
    {
        _connectionString = new SqliteConnectionStringBuilder { DataSource = dbPath }.ToString();
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS Users (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                Name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                KeyHash TEXT NOT NULL UNIQUE,
                CreatedAt TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS Tokens (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                UserId INTEGER NOT NULL,
                TokenHash TEXT NOT NULL UNIQUE,
                Label TEXT NOT NULL,
                CreatedAt TEXT NOT NULL
            );
            """;
        command.ExecuteNonQuery();
        AddColumnIfMissing(connection, "PasswordHash", "TEXT NULL");
        AddColumnIfMissing(connection, "Disabled", "INTEGER NOT NULL DEFAULT 0");
    }

    private static void AddColumnIfMissing(SqliteConnection connection, string column, string definition)
    {
        using var check = connection.CreateCommand();
        check.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Users') WHERE name = @column;";
        check.Parameters.AddWithValue("@column", column);
        if ((long)check.ExecuteScalar()! > 0)
            return;
        using var alter = connection.CreateCommand();
        alter.CommandText = $"ALTER TABLE Users ADD COLUMN {column} {definition};";
        alter.ExecuteNonQuery();
    }

    public static string ResolveDbPath(IConfiguration configuration)
    {
        var configured = configuration["Companion:UsersDbPath"];
        if (!string.IsNullOrWhiteSpace(configured))
            return configured;

        var appDataDir = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData, Environment.SpecialFolderOption.Create);
        var dir = Path.Combine(appDataDir, "ScrapingFactory");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, "users.db");
    }

    private SqliteConnection Open()
    {
        var connection = new SqliteConnection(_connectionString);
        connection.Open();
        return connection;
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
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO Users (Name, KeyHash, CreatedAt, PasswordHash) VALUES (@name, @hash, @createdAt, @password); SELECT last_insert_rowid();";
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@hash", ApiKeys.Hash(key));
        command.Parameters.AddWithValue("@createdAt", createdAt);
        command.Parameters.AddWithValue("@password", (object?)passwordHash ?? DBNull.Value);
        try
        {
            return new UserRecord((long)command.ExecuteScalar()!, name, createdAt, passwordHash is not null);
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        {
            throw new InvalidOperationException($"A user named '{name}' already exists.");
        }
    }

    private static UserRecord Read(SqliteDataReader reader) =>
        new(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetInt64(3) != 0, reader.GetInt64(4) != 0);

    public UserRecord? FindByKey(string key)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        // The user's own key, or one of their per-device tokens — either way a
        // disabled user is turned away.
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
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {UserColumns} FROM Users WHERE Name = @name;";
        command.Parameters.AddWithValue("@name", name);
        using var reader = command.ExecuteReader();
        return reader.Read() ? Read(reader) : null;
    }

    public IReadOnlyList<UserRecord> List()
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {UserColumns} FROM Users ORDER BY Name;";
        var results = new List<UserRecord>();
        using var reader = command.ExecuteReader();
        while (reader.Read()) results.Add(Read(reader));
        return results;
    }

    public bool Remove(string name)
    {
        using var connection = Open();
        using var tokens = connection.CreateCommand();
        tokens.CommandText = "DELETE FROM Tokens WHERE UserId IN (SELECT Id FROM Users WHERE Name = @name);";
        tokens.Parameters.AddWithValue("@name", name);
        tokens.ExecuteNonQuery();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM Users WHERE Name = @name;";
        command.Parameters.AddWithValue("@name", name);
        return command.ExecuteNonQuery() > 0;
    }

    public string? RotateKey(string name)
    {
        var key = ApiKeys.Generate();
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE Users SET KeyHash = @hash WHERE Name = @name;";
        command.Parameters.AddWithValue("@hash", ApiKeys.Hash(key));
        command.Parameters.AddWithValue("@name", name);
        return command.ExecuteNonQuery() > 0 ? key : null;
    }

    public string? GetPasswordHash(string name)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT PasswordHash FROM Users WHERE Name = @name;";
        command.Parameters.AddWithValue("@name", name);
        var value = command.ExecuteScalar();
        return value is string hash ? hash : null;
    }

    public bool SetPassword(string name, string passwordHash)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE Users SET PasswordHash = @password WHERE Name = @name;";
        command.Parameters.AddWithValue("@password", passwordHash);
        command.Parameters.AddWithValue("@name", name);
        return command.ExecuteNonQuery() > 0;
    }

    public bool SetDisabled(string name, bool disabled)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE Users SET Disabled = @disabled WHERE Name = @name;";
        command.Parameters.AddWithValue("@disabled", disabled ? 1 : 0);
        command.Parameters.AddWithValue("@name", name);
        return command.ExecuteNonQuery() > 0;
    }

    public string CreateToken(long userId, string label)
    {
        var token = ApiKeys.Generate();
        using var connection = Open();
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
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM Tokens WHERE TokenHash = @hash;";
        command.Parameters.AddWithValue("@hash", ApiKeys.Hash(token));
        return command.ExecuteNonQuery() > 0;
    }

    public int RevokeTokens(long userId, string? exceptToken = null)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM Tokens WHERE UserId = @user AND (@except IS NULL OR TokenHash <> @except);";
        command.Parameters.AddWithValue("@user", userId);
        command.Parameters.AddWithValue("@except", exceptToken is null ? DBNull.Value : ApiKeys.Hash(exceptToken));
        return command.ExecuteNonQuery();
    }
}
