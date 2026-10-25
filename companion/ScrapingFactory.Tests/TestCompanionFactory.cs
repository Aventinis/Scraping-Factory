using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace ScrapingFactory.Tests;

// The test companion host (WebApplicationFactory<Program>) with configuration overrides and isolated temporary SQLite databases,
// so endpoint tests never share a store or touch the user's real one.
internal static class TestCompanionFactory
{
    public const string SavedConfigsDb = "Companion:SavedConfigsDbPath";
    public const string OutputBlueprintsDb = "Companion:OutputBlueprintsDbPath";
    public const string TransformPresetsDb = "Companion:TransformPresetsDbPath";
    public const string UsersDb = "Companion:UsersDbPath";

    // `settings` override the companion's configuration; `configureHost` adds anything else (e.g. ConfigureTestServices).
    public static WebApplicationFactory<Program> Create(
        IDictionary<string, string?> settings, Action<IWebHostBuilder>? configureHost = null) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(settings));
            configureHost?.Invoke(builder);
        });

    // A fresh path in the temp directory, recorded in `files` so the test can delete it afterwards.
    public static string TempDatabasePath(string name, List<string> files)
    {
        var path = Path.Combine(Path.GetTempPath(), $"sf-{name}-{Guid.NewGuid():N}.db");
        files.Add(path);
        return path;
    }

    // Settings that point all four stores (saved configs, blueprints, presets, users) at their own temp database.
    public static Dictionary<string, string?> TempDatabaseSettings(string prefix, List<string> files) => new()
    {
        [SavedConfigsDb] = TempDatabasePath($"{prefix}-configs", files),
        [OutputBlueprintsDb] = TempDatabasePath($"{prefix}-blueprints", files),
        [TransformPresetsDb] = TempDatabasePath($"{prefix}-presets", files),
        [UsersDb] = TempDatabasePath($"{prefix}-users", files),
    };

    // Releases SQLite's connection pool (it keeps the files open) and deletes the temp databases.
    public static void DeleteDatabases(List<string> files)
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        foreach (var file in files)
        {
            if (File.Exists(file)) File.Delete(file);
        }
    }
}

// A companion host with ONE temp database behind `settingKey` and a client for it: what the per-store endpoint test classes
// (saved configs, outputs, blueprints, transform presets) all need.
internal sealed class TempDatabaseCompanion : IDisposable
{
    private readonly List<string> _files = [];

    public TempDatabaseCompanion(string settingKey, string name)
    {
        DatabasePath = TestCompanionFactory.TempDatabasePath(name, _files);
        Factory = TestCompanionFactory.Create(new Dictionary<string, string?> { [settingKey] = DatabasePath });
        Client = Factory.CreateClient();
    }

    public string DatabasePath { get; }
    public WebApplicationFactory<Program> Factory { get; }
    public HttpClient Client { get; }

    public void Dispose()
    {
        Client.Dispose();
        Factory.Dispose();
        TestCompanionFactory.DeleteDatabases(_files);
    }
}
