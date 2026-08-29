using System.Text.RegularExpressions;

namespace ScrapingFactory.Compiler.IR;

// Reduces a user-typed base filename (script name / output filename) down to
// characters that are always safe to embed verbatim into generated Python
// source and to use as a real filename in PythonScriptVerifier's temp
// directory — no quotes/backslashes to escape, no path separators to enable
// directory traversal, no OS-reserved characters. Falls back to `fallback`
// for empty/whitespace-only/fully-invalid input, the same "don't reject,
// just default" approach OutputFormat/Engine already take elsewhere in
// ScrapingPlanBuilder.
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
