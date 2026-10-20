using Microsoft.Extensions.Configuration;
using ScrapingFactory.Companion;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #346: the optional per-user companion settings file is one more
// configuration source, between appsettings.json and the environment.
[Collection("EnvironmentVariables")]
public class CompanionUserSettingsTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), $"sf-user-settings-{Guid.NewGuid():N}");
    private readonly string? _previousPath = Environment.GetEnvironmentVariable(CompanionUserSettings.PathEnvironmentVariable);
    private readonly string? _previousPort = Environment.GetEnvironmentVariable("Companion__Port");

    public void Dispose()
    {
        Environment.SetEnvironmentVariable(CompanionUserSettings.PathEnvironmentVariable, _previousPath);
        Environment.SetEnvironmentVariable("Companion__Port", _previousPort);
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }

    private IConfiguration Build(string? fileContent, string[]? args = null)
    {
        var path = Path.Combine(_dir, "nested", CompanionUserSettings.FileName);
        Environment.SetEnvironmentVariable(CompanionUserSettings.PathEnvironmentVariable, path);
        if (fileContent is not null)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, fileContent);
        }
        var builder = new ConfigurationBuilder();
        builder.AddInMemoryCollection(new Dictionary<string, string?> { ["Companion:Port"] = "5000", ["Companion:PythonExecutable"] = null });
        builder.AddEnvironmentVariables();
        CompanionUserSettings.Apply(builder, args ?? []);
        return builder.Build();
    }

    [Fact]
    public void AMissingFile_ChangesNothing()
    {
        var configuration = Build(fileContent: null);
        Assert.Equal("5000", configuration["Companion:Port"]);
        Assert.Null(configuration["Companion:PythonExecutable"]);
    }

    [Fact]
    public void TheFile_OverridesTheBaseConfiguration()
    {
        var configuration = Build("""{ "Companion": { "PythonExecutable": "/opt/venv/bin/python", "Port": 5050 } }""");
        Assert.Equal("/opt/venv/bin/python", configuration["Companion:PythonExecutable"]);
        Assert.Equal("5050", configuration["Companion:Port"]);
    }

    [Fact]
    public void EnvironmentVariablesAndCommandLine_StillWinOverTheFile()
    {
        Environment.SetEnvironmentVariable("Companion__Port", "6001");
        var fromEnvironment = Build("""{ "Companion": { "Port": 5050 } }""");
        Assert.Equal("6001", fromEnvironment["Companion:Port"]);

        var fromCommandLine = Build("""{ "Companion": { "Port": 5050 } }""", ["--Companion:Port=6002"]);
        Assert.Equal("6002", fromCommandLine["Companion:Port"]);
    }
}
