namespace ScrapingFactory.Companion.Auth;

public sealed record UserRecord(long Id, string Name, string CreatedAt);

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
}

public static class UserNames
{
    public static bool IsValid(string? name) =>
        name is { Length: > 0 and <= 64 } && System.Text.RegularExpressions.Regex.IsMatch(name, @"^[A-Za-z0-9][A-Za-z0-9._-]*$");

    public const string Rules = "a user name may contain letters, digits, '.', '_' and '-' (at most 64 characters) and starts with a letter or digit";
}
