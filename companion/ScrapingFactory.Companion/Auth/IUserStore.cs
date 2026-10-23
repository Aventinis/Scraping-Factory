namespace ScrapingFactory.Companion.Auth;

public sealed record UserRecord(
    long Id, string Name, string CreatedAt, bool HasPassword = false, bool Disabled = false,
    string? Email = null, bool EmailVerified = false);

// Issue #353: another account already uses that email address.
public sealed class EmailInUseException(string email) : InvalidOperationException($"The email address '{email}' is already in use.");

// Issue #353: the outcome of checking a one-time code. Expired also covers
// "there is no code" (never asked for, already used, replaced by a newer one).
public enum EmailCodeResult { Valid, Wrong, Expired, TooManyAttempts }

public static class EmailCodePurpose
{
    public const string Verify = "verify";
    public const string Reset = "reset";
}

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
    // An optional (already normalized) email address starts unverified;
    // EmailInUseException when another account has it.
    UserRecord CreateWithPassword(string name, string passwordHash, string? email = null);

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

    // ── Issue #353: email address, verification and reset codes ──────────────

    UserRecord? FindByEmail(string email);

    // Sets (or, with null, clears) the user's email address; false when there is
    // no such user, EmailInUseException when another account has it. A changed
    // address replaces the verified flag with `verified` and drops pending
    // verification codes.
    bool SetEmail(long userId, string? email, bool verified);

    bool SetEmailVerified(long userId, bool verified);

    // At most one pending code per user and purpose: a new one replaces the old
    // (and resets its failed attempts). Only the hash of the code is stored.
    void SaveEmailCode(long userId, string purpose, string codeHash, DateTimeOffset expiresAt);

    // Counts the try first (so parallel guesses can't beat the limit), then
    // compares; a correct code is consumed, an expired one or one that used up
    // its `maxAttempts` is deleted.
    EmailCodeResult CheckEmailCode(long userId, string purpose, string codeHash, DateTimeOffset now, int maxAttempts);

    // Deletes the user's pending codes (of one purpose, or all).
    void DeleteEmailCodes(long userId, string? purpose = null);

    // When the pending code of this purpose was issued — the cooldown between two mails.
    DateTimeOffset? EmailCodeSentAt(long userId, string purpose);
}

public static class UserNames
{
    public static bool IsValid(string? name) =>
        name is { Length: > 0 and <= 64 } && System.Text.RegularExpressions.Regex.IsMatch(name, @"^[A-Za-z0-9][A-Za-z0-9._-]*$");

    public const string Rules = "a user name may contain letters, digits, '.', '_' and '-' (at most 64 characters) and starts with a letter or digit";
}
