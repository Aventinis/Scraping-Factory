using System.Security.Cryptography;
using System.Text;

namespace ScrapingFactory.Companion.Auth;

// Issue #352: passwords are stored only as a salted, slow hash — PBKDF2-SHA-256
// from the base library (no extra dependency), with a per-password random salt
// and an iteration count stored next to the hash so it can be raised later
// without invalidating existing passwords. Format:
//   pbkdf2-sha256$<iterations>$<salt base64>$<hash base64>
public static class PasswordHasher
{
    public const int Iterations = 600_000;
    private const int SaltBytes = 16;
    private const int HashBytes = 32;
    private const string Scheme = "pbkdf2-sha256";

    public const int MinimumLength = 10;
    public const int MaximumLength = 128;
    public const string Rules = "a password needs 10 to 128 characters and must differ from the user name";

    // Server-side policy; null = acceptable, otherwise the reason.
    public static string? CheckPolicy(string? password, string userName)
    {
        if (string.IsNullOrEmpty(password) || password.Length < MinimumLength)
            return $"The password must be at least {MinimumLength} characters long.";
        if (password.Length > MaximumLength)
            return $"The password must be at most {MaximumLength} characters long.";
        if (password.Equals(userName, StringComparison.OrdinalIgnoreCase))
            return "The password must differ from the user name.";
        return null;
    }

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var hash = Derive(password, salt, Iterations, HashBytes);
        return $"{Scheme}${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    // Constant-time comparison of the derived hash.
    public static bool Verify(string password, string? stored)
    {
        if (string.IsNullOrEmpty(stored))
            return false;
        var parts = stored.Split('$');
        if (parts.Length != 4 || parts[0] != Scheme || !int.TryParse(parts[1], out var iterations) || iterations < 1)
            return false;
        byte[] salt, expected;
        try
        {
            salt = Convert.FromBase64String(parts[2]);
            expected = Convert.FromBase64String(parts[3]);
        }
        catch (FormatException)
        {
            return false;
        }
        return CryptographicOperations.FixedTimeEquals(Derive(password, salt, iterations, expected.Length), expected);
    }

    // A real hash of nothing in particular: verifying against it costs the same
    // as verifying a real user's password, so an unknown user name can't be told
    // apart from a wrong password by timing.
    public static readonly string DummyHash = Hash("dummy-password-for-timing-only");

    private static byte[] Derive(string password, byte[] salt, int iterations, int length) =>
        Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, iterations, HashAlgorithmName.SHA256, length);
}
