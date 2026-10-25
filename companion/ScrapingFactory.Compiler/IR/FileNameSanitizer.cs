using System.Text.RegularExpressions;

namespace ScrapingFactory.Compiler.IR;

// Reduces a user-typed base file name to characters that are safe in generated Python source and as a real file
// name (no quotes, path separators or reserved characters). Empty or fully invalid input falls back instead of
// being rejected. Mirrored by sanitizeFileNameBase in the extension (test-vectors/file-name-sanitizer.json).
public static class FileNameSanitizer
{
    private static readonly Regex InvalidChars = new("[^A-Za-z0-9_-]+");

    public static string SanitizeBaseName(string? input, string fallback)
    {
        if (string.IsNullOrWhiteSpace(input))
            return fallback;

        var sanitized = InvalidChars.Replace(input.Trim(), "_").Trim('_', '-');
        return sanitized.Length == 0 ? fallback : sanitized;
    }
}
