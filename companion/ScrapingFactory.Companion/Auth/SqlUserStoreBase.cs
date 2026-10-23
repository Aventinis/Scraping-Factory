using System.Data.Common;
using ScrapingFactory.Companion.Storage;

namespace ScrapingFactory.Companion.Auth;

// IUserStore written once for both databases. SqliteUserStore and MySqlUserStore add the tables and the dialect hooks.
public abstract class SqlUserStoreBase : SqlStore, IUserStore
{
    private const string UserColumns = "Id, Name, CreatedAt, PasswordHash IS NOT NULL, Disabled, Email, EmailVerified";

    // INSERT ... ON CONFLICT / ON DUPLICATE KEY: replaces the pending code of (UserId, Purpose).
    protected abstract string SaveEmailCodeSql { get; }

    protected abstract bool IsUniqueViolation(DbException exception);

    // Whether the violated unique index is the email one (the other is the user name).
    protected abstract bool IsEmailViolation(DbException exception);

    private static UserRecord Read(DbDataReader reader) =>
        new(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), ToInt64(reader, 3) != 0, ToInt64(reader, 4) != 0,
            reader.IsDBNull(5) ? null : reader.GetString(5), ToInt64(reader, 6) != 0);

    public (UserRecord User, string Key) Create(string name)
    {
        var key = ApiKeys.Generate();
        return (InsertUser(name, key, passwordHash: null, email: null), key);
    }

    public UserRecord CreateWithPassword(string name, string passwordHash, string? email = null) =>
        InsertUser(name, ApiKeys.Generate(), passwordHash, email);

    private UserRecord InsertUser(string name, string key, string? passwordHash, string? email)
    {
        var createdAt = DateTimeOffset.UtcNow.ToString("O");
        using var connection = OpenConnection();
        try
        {
            var id = Insert(connection,
                "INSERT INTO Users (Name, KeyHash, CreatedAt, PasswordHash, Email) VALUES (@name, @hash, @createdAt, @password, @email);",
                ("@name", name), ("@hash", ApiKeys.Hash(key)), ("@createdAt", createdAt), ("@password", passwordHash), ("@email", email));
            return new UserRecord(id, name, createdAt, passwordHash is not null, Email: email);
        }
        catch (DbException exception) when (IsUniqueViolation(exception))
        {
            if (IsEmailViolation(exception))
                throw new EmailInUseException(email ?? "");
            throw new InvalidOperationException($"A user named '{name}' already exists.");
        }
    }

    // The user's own key or one of their per-device tokens; a disabled user is turned away either way.
    public UserRecord? FindByKey(string key)
    {
        using var connection = OpenConnection();
        return QueryFirst(connection,
            $"SELECT {UserColumns} FROM Users WHERE Disabled = 0 AND (KeyHash = @hash OR Id IN (SELECT UserId FROM Tokens WHERE TokenHash = @hash));",
            Read, ("@hash", ApiKeys.Hash(key)));
    }

    public UserRecord? FindByName(string name)
    {
        using var connection = OpenConnection();
        return QueryFirst(connection, $"SELECT {UserColumns} FROM Users WHERE Name = @name;", Read, ("@name", name));
    }

    public IReadOnlyList<UserRecord> List()
    {
        using var connection = OpenConnection();
        return Query(connection, $"SELECT {UserColumns} FROM Users ORDER BY Name;", Read);
    }

    public bool Remove(string name)
    {
        using var connection = OpenConnection();
        Execute(connection, "DELETE FROM Tokens WHERE UserId IN (SELECT Id FROM Users WHERE Name = @name);", ("@name", name));
        Execute(connection, "DELETE FROM EmailCodes WHERE UserId IN (SELECT Id FROM Users WHERE Name = @name);", ("@name", name));
        return Execute(connection, "DELETE FROM Users WHERE Name = @name;", ("@name", name)) > 0;
    }

    public string? RotateKey(string name)
    {
        var key = ApiKeys.Generate();
        using var connection = OpenConnection();
        return Execute(connection, "UPDATE Users SET KeyHash = @hash WHERE Name = @name;", ("@hash", ApiKeys.Hash(key)), ("@name", name)) > 0
            ? key
            : null;
    }

    public string? GetPasswordHash(string name)
    {
        using var connection = OpenConnection();
        return Scalar(connection, "SELECT PasswordHash FROM Users WHERE Name = @name;", ("@name", name)) as string;
    }

    // UPDATEs report matched rows on both databases (MySQL: UseAffectedRows=false, see StorageOptions), so writing the same
    // value still counts as found.
    public bool SetPassword(string name, string passwordHash)
    {
        using var connection = OpenConnection();
        return Execute(connection, "UPDATE Users SET PasswordHash = @password WHERE Name = @name;", ("@password", passwordHash), ("@name", name)) > 0;
    }

    public bool SetDisabled(string name, bool disabled)
    {
        using var connection = OpenConnection();
        return Execute(connection, "UPDATE Users SET Disabled = @disabled WHERE Name = @name;", ("@disabled", disabled ? 1 : 0), ("@name", name)) > 0;
    }

    public string CreateToken(long userId, string label)
    {
        var token = ApiKeys.Generate();
        using var connection = OpenConnection();
        Execute(connection,
            "INSERT INTO Tokens (UserId, TokenHash, Label, CreatedAt) VALUES (@user, @hash, @label, @createdAt);",
            ("@user", userId), ("@hash", ApiKeys.Hash(token)), ("@label", label), ("@createdAt", DateTimeOffset.UtcNow.ToString("O")));
        return token;
    }

    public bool RevokeToken(string token)
    {
        using var connection = OpenConnection();
        return Execute(connection, "DELETE FROM Tokens WHERE TokenHash = @hash;", ("@hash", ApiKeys.Hash(token))) > 0;
    }

    public int RevokeTokens(long userId, string? exceptToken = null)
    {
        using var connection = OpenConnection();
        return Execute(connection,
            "DELETE FROM Tokens WHERE UserId = @user AND (@except IS NULL OR TokenHash <> @except);",
            ("@user", userId), ("@except", exceptToken is null ? null : ApiKeys.Hash(exceptToken)));
    }

    public UserRecord? FindByEmail(string email)
    {
        using var connection = OpenConnection();
        return QueryFirst(connection, $"SELECT {UserColumns} FROM Users WHERE Email = @email;", Read, ("@email", email));
    }

    public bool SetEmail(long userId, string? email, bool verified)
    {
        using var connection = OpenConnection();
        try
        {
            if (Execute(connection, "UPDATE Users SET Email = @email, EmailVerified = @verified WHERE Id = @id;",
                    ("@email", email), ("@verified", verified && email is not null ? 1 : 0), ("@id", userId)) == 0)
                return false;
        }
        catch (DbException exception) when (IsUniqueViolation(exception))
        {
            throw new EmailInUseException(email ?? "");
        }
        DeleteEmailCodes(userId, EmailCodePurpose.Verify);
        return true;
    }

    public bool SetEmailVerified(long userId, bool verified)
    {
        using var connection = OpenConnection();
        return Execute(connection, "UPDATE Users SET EmailVerified = @verified WHERE Id = @id AND Email IS NOT NULL;",
            ("@verified", verified ? 1 : 0), ("@id", userId)) > 0;
    }

    public void SaveEmailCode(long userId, string purpose, string codeHash, DateTimeOffset expiresAt)
    {
        using var connection = OpenConnection();
        Execute(connection, SaveEmailCodeSql,
            ("@user", userId), ("@purpose", purpose), ("@hash", codeHash),
            ("@expires", expiresAt.UtcDateTime.ToString("O")), ("@created", DateTimeOffset.UtcNow.ToString("O")));
    }

    // The try is counted before the comparison, so parallel guesses cannot beat the limit.
    public EmailCodeResult CheckEmailCode(long userId, string purpose, string codeHash, DateTimeOffset now, int maxAttempts)
    {
        using var connection = OpenConnection();
        if (Execute(connection, "UPDATE EmailCodes SET Attempts = Attempts + 1 WHERE UserId = @user AND Purpose = @purpose;",
                ("@user", userId), ("@purpose", purpose)) == 0)
            return EmailCodeResult.Expired;

        var stored = QueryFirst(connection,
            "SELECT CodeHash, ExpiresAt, Attempts FROM EmailCodes WHERE UserId = @user AND Purpose = @purpose;",
            reader => (Hash: reader.GetString(0), ExpiresAt: reader.GetString(1), Attempts: ToInt64(reader, 2)),
            ("@user", userId), ("@purpose", purpose));
        if (stored.Hash is null)
            return EmailCodeResult.Expired;

        var result = EmailCodeEvaluation.Evaluate(stored.Hash, DateTimeOffset.Parse(stored.ExpiresAt), stored.Attempts, codeHash, now, maxAttempts);
        if (result is not EmailCodeResult.Wrong)
            DeleteEmailCodes(userId, purpose);
        return result;
    }

    public void DeleteEmailCodes(long userId, string? purpose = null)
    {
        using var connection = OpenConnection();
        Execute(connection, "DELETE FROM EmailCodes WHERE UserId = @user AND (@purpose IS NULL OR Purpose = @purpose);",
            ("@user", userId), ("@purpose", purpose));
    }

    public DateTimeOffset? EmailCodeSentAt(long userId, string purpose)
    {
        using var connection = OpenConnection();
        return Scalar(connection, "SELECT CreatedAt FROM EmailCodes WHERE UserId = @user AND Purpose = @purpose;",
            ("@user", userId), ("@purpose", purpose)) is string created ? DateTimeOffset.Parse(created) : null;
    }
}
