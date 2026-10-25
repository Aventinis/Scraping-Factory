using System.Text;

namespace ScrapingFactory.Tests;

// Issue #386: reading and writing the snapshot files, and the failure message.
public static class SnapshotSupport
{
    public const string UpdateVariable = "UPDATE_SNAPSHOTS";
    public const string UpdateCommand = "UPDATE_SNAPSHOTS=1 dotnet test companion/ScrapingFactory.sln --filter Snapshot";

    public static bool UpdateRequested => Environment.GetEnvironmentVariable(UpdateVariable) == "1";

    /// <summary>The Snapshots folder in the SOURCE tree (the tests run from bin/, updates must reach git).</summary>
    public static string SnapshotsDirectory { get; } = FindSnapshotsDirectory();

    private static string FindSnapshotsDirectory()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "ScrapingFactory.Tests.csproj")))
            directory = directory.Parent;
        if (directory is null) throw new InvalidOperationException("Could not find the ScrapingFactory.Tests source folder from " + AppContext.BaseDirectory);
        return Path.Combine(directory.FullName, "Snapshots");
    }

    public static string PathFor(string id) => Path.Combine(SnapshotsDirectory, id + ".py");

    /// <summary>
    /// Line endings are not part of the product (a template read from a CRLF checkout renders with
    /// them), so snapshots are compared and stored with LF.
    /// </summary>
    public static string Normalize(string script) => script.Replace("\r\n", "\n");

    public static void Write(string id, string script)
    {
        Directory.CreateDirectory(SnapshotsDirectory);
        File.WriteAllText(PathFor(id), Normalize(script), new UTF8Encoding(false));
    }

    /// <summary>A failure message that says what differs and how to accept it.</summary>
    public static string Describe(string id, string expected, string actual)
    {
        var expectedLines = expected.Split('\n');
        var actualLines = actual.Split('\n');
        var line = 0;
        while (line < expectedLines.Length && line < actualLines.Length && expectedLines[line] == actualLines[line]) line++;

        var actualFile = Path.Combine(Path.GetTempPath(), "sf-snapshot-actual", id + ".py");
        Directory.CreateDirectory(Path.GetDirectoryName(actualFile)!);
        File.WriteAllText(actualFile, actual, new UTF8Encoding(false));

        string At(string[] lines, int index) => index < lines.Length ? lines[index] : "<end of file>";
        var sb = new StringBuilder();
        sb.AppendLine($"The generated script for snapshot '{id}' differs from Snapshots/{id}.py.");
        sb.AppendLine($"First difference at line {line + 1} ({expectedLines.Length} lines expected, {actualLines.Length} generated):");
        sb.AppendLine($"  expected: {At(expectedLines, line)}");
        sb.AppendLine($"  actual:   {At(actualLines, line)}");
        sb.AppendLine($"Full output: {actualFile}");
        sb.AppendLine($"Compare:     diff {PathFor(id)} {actualFile}");
        sb.AppendLine("If the change is intended (a template, fragment or generator was changed on purpose), accept it with");
        sb.AppendLine($"  {UpdateCommand}");
        sb.Append("and review the changed snapshot files in the diff.");
        return sb.ToString();
    }
}
