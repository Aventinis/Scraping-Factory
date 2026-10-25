using System.Data.Common;
using MySqlConnector;
using ScrapingFactory.Companion.Storage;

namespace ScrapingFactory.Companion.Auth;

// MySQL/MariaDB backend of IUserStore: the Users table lives in the same database as the other stores, so a shared server's
// users and their data are one thing. The queries are in SqlUserStoreBase.
public sealed class MySqlUserStore : SqlUserStoreBase
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
        // Email is unique and case-insensitive under the default collation.
        MySqlSchema.EnsureColumn(connection, "Users", "Email", "VARCHAR(254) NULL");
        MySqlSchema.EnsureColumn(connection, "Users", "EmailVerified", "TINYINT(1) NOT NULL DEFAULT 0");
        MySqlSchema.EnsureIndex(connection, "Users", "UX_Users_Email", "UNIQUE KEY UX_Users_Email (Email)");
        MySqlSchema.Execute(connection, """
            CREATE TABLE IF NOT EXISTS EmailCodes (
                UserId BIGINT NOT NULL,
                Purpose VARCHAR(20) NOT NULL,
                CodeHash CHAR(64) NOT NULL,
                ExpiresAt VARCHAR(40) NOT NULL,
                Attempts INT NOT NULL DEFAULT 0,
                CreatedAt VARCHAR(40) NOT NULL,
                PRIMARY KEY (UserId, Purpose)
            ) CHARACTER SET utf8mb4;
            """);
    }

    protected override DbConnection OpenConnection() => MySqlSchema.Open(_connectionString);

    protected override string LastInsertIdSql => "SELECT LAST_INSERT_ID();";

    protected override string SaveEmailCodeSql => """
        INSERT INTO EmailCodes (UserId, Purpose, CodeHash, ExpiresAt, Attempts, CreatedAt)
        VALUES (@user, @purpose, @hash, @expires, 0, @created)
        ON DUPLICATE KEY UPDATE CodeHash = @hash, ExpiresAt = @expires, Attempts = 0, CreatedAt = @created;
        """;

    protected override bool IsUniqueViolation(DbException exception) =>
        exception is MySqlException { ErrorCode: MySqlErrorCode.DuplicateKeyEntry };

    protected override bool IsEmailViolation(DbException exception) =>
        exception.Message.Contains("UX_Users_Email", StringComparison.OrdinalIgnoreCase);
}
