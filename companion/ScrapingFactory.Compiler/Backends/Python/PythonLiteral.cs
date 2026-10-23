namespace ScrapingFactory.Compiler.Backends.Python;

// Shared by the C#-side Python literal builders: a single-quoted string literal, escaped so a user-entered value
// cannot break out of it.
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

    // A Python list-of-strings literal, e.g. ['#outer', '#inner'] (FramePath).
    public static string StrList(IEnumerable<string> values) =>
        "[" + string.Join(", ", values.Select(Str)) + "]";

    // An unquoted numeric literal in the shortest round-trippable invariant form (42, 3.14).
    public static string Num(double value) => value.ToString(System.Globalization.CultureInfo.InvariantCulture);
}
