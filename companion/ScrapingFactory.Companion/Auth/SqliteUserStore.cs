using System.Data.Common;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using ScrapingFactory.Companion.Storage;

namespace ScrapingFactory.Companion.Auth;

// SQLite backend of IUserStore: its own file (users.db, Companion:UsersDbPath). The queries are in SqlUserStoreBase.
public sealed class SqliteUserStore : SqlUserStoreBase
{
    private readonly string _connectionString;

    public SqliteUserStore(IConfiguration configuration) : this(ResolveDbPath(configuration)) { }

    public SqliteUserStore(string dbPath)
    {
        _connectionString = new SqliteConnectionStringBuilder { DataSource = dbPath }.ToString();
        using var connection = SqliteSchema.Open(_connectionString);
        SqliteSchema.Execute(connection, """
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
            """);
        SqliteSchema.EnsureColumn(connection, "Users", "PasswordHash", "TEXT NULL");
        SqliteSchema.EnsureColumn(connection, "Users", "Disabled", "INTEGER NOT NULL DEFAULT 0");
        // Unique and case-insensitive; several NULLs are fine.
        SqliteSchema.EnsureColumn(connection, "Users", "Email", "TEXT NULL COLLATE NOCASE");
        SqliteSchema.EnsureColumn(connection, "Users", "EmailVerified", "INTEGER NOT NULL DEFAULT 0");
        SqliteSchema.Execute(connection, "CREATE UNIQUE INDEX IF NOT EXISTS UX_Users_Email ON Users(Email);");
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

    protected override DbConnection OpenConnection()
    {
        var connection = new SqliteConnection(_connectionString);
        connection.Open();
        return connection;
    }

    protected override string LastInsertIdSql => "SELECT last_insert_rowid();";

    protected override string SaveEmailCodeSql => """
        INSERT INTO EmailCodes (UserId, Purpose, CodeHash, ExpiresAt, Attempts, CreatedAt)
        VALUES (@user, @purpose, @hash, @expires, 0, @created)
        ON CONFLICT(UserId, Purpose) DO UPDATE SET
            CodeHash = @hash, ExpiresAt = @expires, Attempts = 0, CreatedAt = @created;
        """;

    protected override bool IsUniqueViolation(DbException exception) => exception is SqliteException { SqliteErrorCode: 19 };

    protected override bool IsEmailViolation(DbException exception) =>
        exception.Message.Contains("Users.Email", StringComparison.OrdinalIgnoreCase);
}
