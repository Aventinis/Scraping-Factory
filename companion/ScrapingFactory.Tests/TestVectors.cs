using System.Text.Json;

namespace ScrapingFactory.Tests;

// Issue #388: reads the shared test vectors (repo-root test-vectors/*.json), the same files Jest reads
// through test-vectors/load.js. A file is { "description", "cases": [ { "name", ... } ] }; every case has
// a unique name, used as the xUnit display name. See test-vectors/README.md.
public static class TestVectors
{
    private static readonly Lazy<string> Directory = new(FindDirectory);

    private static string FindDirectory()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "test-vectors");
            if (System.IO.Directory.Exists(candidate)) return candidate;
        }
        throw new DirectoryNotFoundException("test-vectors/ not found above " + AppContext.BaseDirectory);
    }

    public static string PathOf(string file) => Path.Combine(Directory.Value, file);

    /// <summary>All cases of a vector file, each a cloned element that stays valid after the document is gone.</summary>
    public static IReadOnlyList<JsonElement> Cases(string file)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(PathOf(file)));
        var cases = document.RootElement.GetProperty("cases").EnumerateArray().Select(c => c.Clone()).ToList();
        var names = new HashSet<string>();
        foreach (var testCase in cases)
            if (!names.Add(testCase.GetProperty("name").GetString()!))
                throw new InvalidOperationException($"{file}: duplicate case name '{testCase.GetProperty("name").GetString()}'");
        if (cases.Count == 0) throw new InvalidOperationException($"{file}: no cases");
        return cases;
    }

    /// <summary>xUnit MemberData: one row per case holding only its name (look the case up with <see cref="Case"/>).</summary>
    public static IEnumerable<object[]> Names(string file) => Cases(file).Select(c => new object[] { c.GetProperty("name").GetString()! });

    public static JsonElement Case(string file, string name) => Cases(file).Single(c => c.GetProperty("name").GetString() == name);

    /// <summary>The string value of a property, or null when it is missing or JSON null.</summary>
    public static string? StringOrNull(this JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind != JsonValueKind.Null ? value.GetString() : null;
}
