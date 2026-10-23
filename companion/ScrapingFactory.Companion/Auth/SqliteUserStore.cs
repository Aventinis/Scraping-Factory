using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;

namespace ScrapingFactory.Companion.Auth;

// Issue #278: SQLite implementation of IUserStore — its own small file
// (users.db, Companion:UsersDbPath), like every other local store.
// Issue #352: PasswordHash/Disabled columns (idempotent migration) and a Tokens
// table for per-device login tokens.
public sealed class SqliteUserStore : IUserStore
{
    private const string UserColumns = "Id, Name, CreatedAt, PasswordHash IS NOT NULL, Disabled, Email, EmailVerified";
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
            CREATE TABLE IF NOT EXISTS EmailCodes (
                UserId INTEGER NOT NULL,
                Purpose TEXT NOT NULL,
                CodeHash TEXT NOT NULL,
                ExpiresAt TEXT NOT NULL,
                Attempts INTEGER NOT NULL DEFAULT 0,
                CreatedAt TEXT NOT NULL,
                PRIMARY KEY (UserId, Purpose)
            );
            """;
        command.ExecuteNonQuery();
        AddColumnIfMissing(connection, "PasswordHash", "TEXT NULL");
        AddColumnIfMissing(connection, "Disabled", "INTEGER NOT NULL DEFAULT 0");
        // Issue #353: a unique, case-insensitive email address (several NULLs are fine) and its verified flag.
        AddColumnIfMissing(connection, "Email", "TEXT NULL COLLATE NOCASE");
        AddColumnIfMissing(connection, "EmailVerified", "INTEGER NOT NULL DEFAULT 0");
        using var index = connection.CreateCommand();
        index.CommandText = "CREATE UNIQUE INDEX IF NOT EXISTS UX_Users_Email ON Users(Email);";
        index.ExecuteNonQuery();
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

    public UserRecord CreateWithPassword(string name, string passwordHash, string? email = null) =>
        Insert(name, ApiKeys.Generate(), passwordHash, email);

    private UserRecord Insert(string name, string key, string? passwordHash, string? email = null)
    {
        var createdAt = DateTimeOffset.UtcNow.ToString("O");
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO Users (Name, KeyHash, CreatedAt, PasswordHash, Email) VALUES (@name, @hash, @createdAt, @password, @email); SELECT last_insert_rowid();";
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@hash", ApiKeys.Hash(key));
        command.Parameters.AddWithValue("@createdAt", createdAt);
        command.Parameters.AddWithValue("@password", (object?)passwordHash ?? DBNull.Value);
        command.Parameters.AddWithValue("@email", (object?)email ?? DBNull.Value);
        try
        {
            return new UserRecord((long)command.ExecuteScalar()!, name, createdAt, passwordHash is not null, Email: email);
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        {
            if (exception.Message.Contains("Users.Email", StringComparison.OrdinalIgnoreCase))
                throw new EmailInUseException(email ?? "");
            throw new InvalidOperationException($"A user named '{name}' already exists.");
        }
    }

    private static UserRecord Read(SqliteDataReader reader) =>
        new(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.GetInt64(3) != 0, reader.GetInt64(4) != 0,
            reader.IsDBNull(5) ? null : reader.GetString(5), reader.GetInt64(6) != 0);

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
        using var codes = connection.CreateCommand();
        codes.CommandText = "DELETE FROM EmailCodes WHERE UserId IN (SELECT Id FROM Users WHERE Name = @name);";
        codes.Parameters.AddWithValue("@name", name);
        codes.ExecuteNonQuery();
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

    // ── Issue #353 ───────────────────────────────────────────────────────────

    public UserRecord? FindByEmail(string email)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {UserColumns} FROM Users WHERE Email = @email;";
        command.Parameters.AddWithValue("@email", email);
        using var reader = command.ExecuteReader();
        return reader.Read() ? Read(reader) : null;
    }

    public bool SetEmail(long userId, string? email, bool verified)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE Users SET Email = @email, EmailVerified = @verified WHERE Id = @id;";
        command.Parameters.AddWithValue("@email", (object?)email ?? DBNull.Value);
        command.Parameters.AddWithValue("@verified", verified && email is not null ? 1 : 0);
        command.Parameters.AddWithValue("@id", userId);
        try
        {
            if (command.ExecuteNonQuery() == 0)
                return false;
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        {
            throw new EmailInUseException(email ?? "");
        }
        DeleteEmailCodes(userId, EmailCodePurpose.Verify);
        return true;
    }

    public bool SetEmailVerified(long userId, bool verified)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE Users SET EmailVerified = @verified WHERE Id = @id AND Email IS NOT NULL;";
        command.Parameters.AddWithValue("@verified", verified ? 1 : 0);
        command.Parameters.AddWithValue("@id", userId);
        return command.ExecuteNonQuery() > 0;
    }

    public void SaveEmailCode(long userId, string purpose, string codeHash, DateTimeOffset expiresAt)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO EmailCodes (UserId, Purpose, CodeHash, ExpiresAt, Attempts, CreatedAt)
            VALUES (@user, @purpose, @hash, @expires, 0, @created)
            ON CONFLICT(UserId, Purpose) DO UPDATE SET
                CodeHash = @hash, ExpiresAt = @expires, Attempts = 0, CreatedAt = @created;
            """;
        command.Parameters.AddWithValue("@user", userId);
        command.Parameters.AddWithValue("@purpose", purpose);
        command.Parameters.AddWithValue("@hash", codeHash);
        command.Parameters.AddWithValue("@expires", expiresAt.UtcDateTime.ToString("O"));
        command.Parameters.AddWithValue("@created", DateTimeOffset.UtcNow.ToString("O"));
        command.ExecuteNonQuery();
    }

    public EmailCodeResult CheckEmailCode(long userId, string purpose, string codeHash, DateTimeOffset now, int maxAttempts)
    {
        using var connection = Open();
        using (var count = connection.CreateCommand())
        {
            count.CommandText = "UPDATE EmailCodes SET Attempts = Attempts + 1 WHERE UserId = @user AND Purpose = @purpose;";
            count.Parameters.AddWithValue("@user", userId);
            count.Parameters.AddWithValue("@purpose", purpose);
            if (count.ExecuteNonQuery() == 0)
                return EmailCodeResult.Expired;
        }
        string storedHash, expiresAt;
        long attempts;
        using (var read = connection.CreateCommand())
        {
            read.CommandText = "SELECT CodeHash, ExpiresAt, Attempts FROM EmailCodes WHERE UserId = @user AND Purpose = @purpose;";
            read.Parameters.AddWithValue("@user", userId);
            read.Parameters.AddWithValue("@purpose", purpose);
            using var reader = read.ExecuteReader();
            if (!reader.Read())
                return EmailCodeResult.Expired;
            storedHash = reader.GetString(0);
            expiresAt = reader.GetString(1);
            attempts = reader.GetInt64(2);
        }
        var result = EmailCodeEvaluation.Evaluate(storedHash, DateTimeOffset.Parse(expiresAt), attempts, codeHash, now, maxAttempts);
        if (result is not EmailCodeResult.Wrong)
            DeleteEmailCodes(userId, purpose);
        return result;
    }

    public void DeleteEmailCodes(long userId, string? purpose = null)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM EmailCodes WHERE UserId = @user AND (@purpose IS NULL OR Purpose = @purpose);";
        command.Parameters.AddWithValue("@user", userId);
        command.Parameters.AddWithValue("@purpose", (object?)purpose ?? DBNull.Value);
        command.ExecuteNonQuery();
    }

    public DateTimeOffset? EmailCodeSentAt(long userId, string purpose)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT CreatedAt FROM EmailCodes WHERE UserId = @user AND Purpose = @purpose;";
        command.Parameters.AddWithValue("@user", userId);
        command.Parameters.AddWithValue("@purpose", purpose);
        return command.ExecuteScalar() is string created ? DateTimeOffset.Parse(created) : null;
    }
}
