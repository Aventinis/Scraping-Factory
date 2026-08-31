namespace ScrapingFactory.Compiler.Backends.Python;

// Shared across every C#-side Python literal builder (PythonGroupTreeLiteral,
// PythonApiConfigLiteral): a single-quoted Python string literal, escaped for
// the characters a user-entered value could plausibly contain (backslash,
// single quote, newline/CR/tab) so it can't break out of the literal or
// corrupt the generated script.
internal static class PythonLiteral
{
    public static string Str(string value)
    {
        var escaped = value
            .Replace("\\", "\\\\")
            .Replace("'", "\\'")
            .Replace("\n", "\\n")
            .Replace("\r", "\\r")
            .Replace("\t", "\\t");
        return $"'{escaped}'";
    }

    // A Python list-of-strings literal, e.g. ['#outer', '#inner'] — used for
    // FramePath (Issue #42, Phase 3: GroupNode/DataFieldNode.FramePath).
    public static string StrList(IEnumerable<string> values) =>
        "[" + string.Join(", ", values.Select(Str)) + "]";
}
