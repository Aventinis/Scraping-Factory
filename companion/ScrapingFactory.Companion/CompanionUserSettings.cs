using Microsoft.Extensions.Configuration;

namespace ScrapingFactory.Companion;

// An optional per-user settings file next to the companion's data, read as one more configuration source. The bundle
// installer writes its Python interpreter here; it also gives per-installation settings a home that an update does not
// overwrite (unlike the appsettings.json in the program folder).
//
// Precedence (later wins): appsettings.json < this file < environment variables < command line.
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
