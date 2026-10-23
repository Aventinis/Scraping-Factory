using Microsoft.Extensions.Configuration;
using MySqlConnector;
using ScrapingFactory.Companion.Auth;

namespace ScrapingFactory.Companion.Storage;

// Which backend holds saved configurations/outputs, Output Blueprints and transform presets:
//
//   Companion:Storage:Provider                  "Sqlite" (default) | "MySql"
//   Companion:Storage:MySql:ConnectionString    required for "MySql"
//
// Set via the usual configuration chain (appsettings.json, companion.settings.json, environment variables such as
// Companion__Storage__Provider). "Sqlite" keeps one local file per store; with "MySql" all three stores share the one
// database (tables are created on first use, later columns by idempotent migrations).
public static class StorageOptions
{
    public const string ProviderKey = "Companion:Storage:Provider";
    public const string MySqlConnectionStringKey = "Companion:Storage:MySql:ConnectionString";

    public enum Provider { Sqlite, MySql }

    public static Provider ResolveProvider(IConfiguration configuration)
    {
        var configured = configuration[ProviderKey];
        if (string.IsNullOrWhiteSpace(configured) || configured.Trim().Equals("Sqlite", StringComparison.OrdinalIgnoreCase))
            return Provider.Sqlite;
        if (configured.Trim().Equals("MySql", StringComparison.OrdinalIgnoreCase))
            return Provider.MySql;
        throw new InvalidOperationException($"Unknown storage provider '{configured}' in {ProviderKey} — use \"Sqlite\" or \"MySql\".");
    }

    // Normalized through MySqlConnectionStringBuilder so a malformed string fails at startup. UseAffectedRows=false makes
    // UPDATE report matched rows (the stores' "false = no such id" contract).
    public static string BuildMySqlConnectionString(IConfiguration configuration)
    {
        var raw = configuration[MySqlConnectionStringKey];
        if (string.IsNullOrWhiteSpace(raw))
            throw new InvalidOperationException($"{MySqlConnectionStringKey} is required when {ProviderKey} is \"MySql\" (e.g. \"Server=localhost;Port=3306;Database=scrapingfactory;User ID=sf;Password=...\").");
        var builder = new MySqlConnectionStringBuilder(raw) { UseAffectedRows = false };
        return builder.ConnectionString;
    }

    // Called once at startup: validates without connecting (an unreachable database only fails the first request), so a
    // typo or a missing connection string stops the companion with a clear message.
    public static void Validate(IConfiguration configuration)
    {
        if (ResolveProvider(configuration) == Provider.MySql)
            BuildMySqlConnectionString(configuration);
    }

    public static ISavedConfigStore CreateSavedConfigStore(IConfiguration configuration) =>
        ResolveProvider(configuration) == Provider.MySql
            ? new MySqlSavedConfigStore(BuildMySqlConnectionString(configuration))
            : new SavedConfigStore(configuration);

    public static IOutputBlueprintStore CreateOutputBlueprintStore(IConfiguration configuration) =>
        ResolveProvider(configuration) == Provider.MySql
            ? new MySqlOutputBlueprintStore(BuildMySqlConnectionString(configuration))
            : new OutputBlueprintStore(configuration);

    public static ITransformPresetStore CreateTransformPresetStore(IConfiguration configuration) =>
        ResolveProvider(configuration) == Provider.MySql
            ? new MySqlTransformPresetStore(BuildMySqlConnectionString(configuration))
            : new TransformPresetStore(configuration);

    // Issue #278: the users live in the same backend as the data they own.
    public static IUserStore CreateUserStore(IConfiguration configuration) =>
        ResolveProvider(configuration) == Provider.MySql
            ? new MySqlUserStore(BuildMySqlConnectionString(configuration))
            : new SqliteUserStore(configuration);
}
