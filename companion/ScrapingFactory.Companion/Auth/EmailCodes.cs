using System.Security.Cryptography;
using System.Text;

namespace ScrapingFactory.Companion.Auth;

// Issue #353: the one-time codes that prove control of an email address
// (verification) or authorize a password reset. An 8-digit number the person
// types into the extension — a link would need the companion to be reachable
// from wherever the mail is read. Only a hash is stored (bound to the user and
// the purpose, so a code for one thing can't be replayed for another), a code
// is single-use, short-lived, and dies after a handful of wrong guesses.
public static class EmailCodes
{
    public const int Digits = 8;
    public const int MaxAttempts = 5;
    public static readonly TimeSpan VerifyLifetime = TimeSpan.FromHours(24);
    public static readonly TimeSpan ResetLifetime = TimeSpan.FromMinutes(30);

    // Uniformly random, leading zeros kept.
    public static string Generate() =>
        RandomNumberGenerator.GetInt32(0, (int)Math.Pow(10, Digits)).ToString($"D{Digits}");

    // What a person might type: "1234 5678", "1234-5678"; null when it isn't a code at all.
    public static string? Normalize(string? typed)
    {
        if (typed is null)
            return null;
        var digits = new string(typed.Where(char.IsAsciiDigit).ToArray());
        var rest = typed.Where(c => !char.IsAsciiDigit(c) && !char.IsWhiteSpace(c) && c != '-');
        return digits.Length == Digits && !rest.Any() ? digits : null;
    }

    public static string Hash(long userId, string purpose, string code) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{purpose}:{userId}:{code}"))).ToLowerInvariant();

    public static TimeSpan Lifetime(string purpose) => purpose == EmailCodePurpose.Reset ? ResetLifetime : VerifyLifetime;
}

// The decision both store implementations share, so SQLite and MySQL can't drift.
public static class EmailCodeEvaluation
{
    // `attempts` already includes the current try.
    public static EmailCodeResult Evaluate(string storedHash, DateTimeOffset expiresAt, long attempts, string givenHash, DateTimeOffset now, int maxAttempts)
    {
        if (now > expiresAt)
            return EmailCodeResult.Expired;
        if (attempts > maxAttempts)
            return EmailCodeResult.TooManyAttempts;
        var equal = CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(storedHash), Encoding.ASCII.GetBytes(givenHash));
        return equal ? EmailCodeResult.Valid : EmailCodeResult.Wrong;
    }
}
