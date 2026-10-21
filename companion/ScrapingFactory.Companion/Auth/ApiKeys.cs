using System.Security.Cryptography;
using System.Text;

namespace ScrapingFactory.Companion.Auth;

// Issue #278: the access key a user pastes into the extension. 32 random bytes
// (256 bits), shown exactly once when the user is created or the key rotated;
// only its SHA-256 is stored, so a leaked database does not leak working keys
// (a random 256-bit secret needs no salt/stretching — it cannot be guessed or
// found in a dictionary).
public static class ApiKeys
{
    public const string Prefix = "sf_";

    public static string Generate() =>
        Prefix + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static string Hash(string key) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key))).ToLowerInvariant();
}
