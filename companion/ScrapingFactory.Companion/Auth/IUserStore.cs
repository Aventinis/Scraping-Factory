namespace ScrapingFactory.Companion.Auth;

public sealed record UserRecord(long Id, string Name, string CreatedAt, bool HasPassword = false, bool Disabled = false);

// Issue #278: the users a companion with authentication knows about. Ids start
// at 1 — 0 is the owner id of data saved without authentication. Provisioned
// out-of-band by whoever runs the companion (the `user` command line, see
// UserCommands), never self-service from the extension. "Not found" is
// null/false, a duplicate name is an InvalidOperationException from Create.
public interface IUserStore
{
    // Creates the user and returns the plaintext key (only its hash is stored).
    (UserRecord User, string Key) Create(string name);

    UserRecord? FindByKey(string key);

    UserRecord? FindByName(string name);

    IReadOnlyList<UserRecord> List();

    bool Remove(string name);

    // Replaces the user's key; null when no such user.
    string? RotateKey(string name);

    // ── Issue #352: password accounts and per-device tokens ──────────────────

    // A self-registered user: has a password hash and — since the key column
    // is mandatory — a random key nobody ever sees (an operator can still
    // `user rotate` a real one). Throws InvalidOperationException on a duplicate name.
    UserRecord CreateWithPassword(string name, string passwordHash);

    // The stored hash, or null when the user doesn't exist or has no password
    // (a user created by `user add` has none until one is set).
    string? GetPasswordHash(string name);

    bool SetPassword(string name, string passwordHash);

    // A disabled user's key and tokens stop working; their data stays.
    bool SetDisabled(string name, bool disabled);

    // A login issues a per-device token (an access key, like the ones from
    // `user add`, but individually revocable); only its hash is stored.
    string CreateToken(long userId, string label);

    bool RevokeToken(string token);

    // Revokes every token of the user (except `exceptToken`, if given);
    // returns how many were removed.
    int RevokeTokens(long userId, string? exceptToken = null);
}

public static class UserNames
{
    public static bool IsValid(string? name) =>
        name is { Length: > 0 and <= 64 } && System.Text.RegularExpressions.Regex.IsMatch(name, @"^[A-Za-z0-9][A-Za-z0-9._-]*$");

    public const string Rules = "a user name may contain letters, digits, '.', '_' and '-' (at most 64 characters) and starts with a letter or digit";
}
