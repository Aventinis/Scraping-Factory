using Microsoft.Extensions.Configuration;

namespace ScrapingFactory.Companion;

// Issue #346: an optional per-user settings file next to the companion's own
// data (the same per-user app-data directory the SQLite stores live in), read
// as one more configuration source. The bundle installer writes the dedicated
// Python interpreter it created here (Companion:PythonExecutable), and later
// per-installation settings (e.g. a database connection) have a home that
// doesn't require editing the appsettings.json shipped inside the program
// folder (which an update would overwrite).
//
// Precedence (later wins): appsettings.json < this file < environment
// variables < command-line arguments — so Companion__Port=5050 or
// --Companion:Port=5050 still override the file, exactly as they override
// appsettings.json.
public static class CompanionUserSettings
{
    public const string FileName = "companion.settings.json";
    public const string PathEnvironmentVariable = "SCRAPINGFACTORY_COMPANION_SETTINGS";

    public static string ResolvePath()
    {
        var overridePath = Environment.GetEnvironmentVariable(PathEnvironmentVariable);
        if (!string.IsNullOrWhiteSpace(overridePath))
            return overridePath;

        var appDataDir = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        return Path.Combine(appDataDir, "ScrapingFactory", FileName);
    }

    public static void Apply(IConfigurationBuilder configuration, string[] args)
    {
        configuration.AddJsonFile(ResolvePath(), optional: true, reloadOnChange: false);
        // The default web-host sources (environment variables, command line)
        // were added before this file, which would let the file override
        // them — add them again so they win, as documented above.
        configuration.AddEnvironmentVariables();
        configuration.AddCommandLine(args);
    }
}
