using Microsoft.Extensions.Configuration;
using MySqlConnector;

namespace ScrapingFactory.Companion.Storage;

// Issue #277: which backend holds the saved configurations/outputs, Output
// Blueprints and transform presets (the three interfaces from Issue #276).
//
//   Companion:Storage:Provider                  "Sqlite" (default) | "MySql"
//   Companion:Storage:MySql:ConnectionString    required for "MySql"
//
// Set in appsettings.json, the per-user companion.settings.json (Issue #346),
// or as environment variables (Companion__Storage__Provider=MySql,
// Companion__Storage__MySql__ConnectionString=...) — the usual precedence.
// "Sqlite" keeps today's behavior exactly (one local file per store, see the
// *DbPath settings). With "MySql" all three stores live in the one configured
// database (tables are created on first use, later columns are added by
// idempotent migrations).
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

    // Normalized through MySqlConnectionStringBuilder so a malformed string
    // fails at startup with the driver's own message. UseAffectedRows=false
    // makes UPDATE report *matched* rows (the stores' "false = no such id"
    // contract), not only changed ones.
    public static string BuildMySqlConnectionString(IConfiguration configuration)
    {
        var raw = configuration[MySqlConnectionStringKey];
        if (string.IsNullOrWhiteSpace(raw))
            throw new InvalidOperationException($"{MySqlConnectionStringKey} is required when {ProviderKey} is \"MySql\" (e.g. \"Server=localhost;Port=3306;Database=scrapingfactory;User ID=sf;Password=...\").");
        var builder = new MySqlConnectionStringBuilder(raw) { UseAffectedRows = false };
        return builder.ConnectionString;
    }

    // Called once at startup — validates the configuration without opening a
    // connection (an unreachable database then only fails the first request,
    // see the MySqlException handler in Program.cs), so a typo in the
    // provider name or a missing connection string stops the companion with
    // a clear message instead of surfacing later.
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
}
