using Microsoft.Extensions.Configuration;
using MySqlConnector;
using ScrapingFactory.Companion;
using ScrapingFactory.Companion.Storage;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #277: the same behavioral contract (see ISavedConfigStore /
// IOutputBlueprintStore / ITransformPresetStore) checked against every
// implementation — SQLite always, MySQL when SF_TEST_MYSQL names a server
// the test may create databases on, e.g.
//   SF_TEST_MYSQL="Server=127.0.0.1;Port=3399;User ID=root;Password=sf"
// (CI starts a MySQL service container and sets it; without it the MySQL
// variants are reported as skipped). Every MySQL test gets its own throwaway
// database, so tests never see each other's rows.

public sealed class MySqlFactAttribute : FactAttribute
{
    public MySqlFactAttribute()
    {
        if (MySqlTestDatabase.ServerConnectionString is null)
            Skip = $"{MySqlTestDatabase.EnvironmentVariable} is not set (no MySQL server to test against).";
    }
}

public sealed class MySqlTestDatabase : IDisposable
{
    public const string EnvironmentVariable = "SF_TEST_MYSQL";
    public static string? ServerConnectionString => Environment.GetEnvironmentVariable(EnvironmentVariable) is { Length: > 0 } value ? value : null;

    private readonly string _name = $"sf_test_{Guid.NewGuid():N}";

    public string ConnectionString { get; }

    public MySqlTestDatabase()
    {
        using var connection = new MySqlConnection(ServerConnectionString);
        connection.Open();
        using var create = connection.CreateCommand();
        create.CommandText = $"CREATE DATABASE `{_name}` CHARACTER SET utf8mb4;";
        create.ExecuteNonQuery();
        ConnectionString = new MySqlConnectionStringBuilder(ServerConnectionString!) { Database = _name }.ConnectionString;
    }

    public void Dispose()
    {
        MySqlConnection.ClearAllPools();
        using var connection = new MySqlConnection(ServerConnectionString);
        connection.Open();
        using var drop = connection.CreateCommand();
        drop.CommandText = $"DROP DATABASE IF EXISTS `{_name}`;";
        drop.ExecuteNonQuery();
    }
}

// ── The contract, written once ───────────────────────────────────────────────

internal static class SavedConfigStoreContract
{
    public static void SaveAndGet_RoundTripsTheConfigVerbatim(ISavedConfigStore store)
    {
        // Larger than MySQL's 64 KB TEXT limit, with non-ASCII text.
        var json = "{\"note\":\"" + new string('ä', 70_000) + "\"}";
        var saved = store.Save("https://example.com/a", "Größe", json, blueprintId: 7);

        var record = store.Get(saved.Id)!;
        Assert.Equal(json, record.ConfigJson);
        Assert.Equal("Größe", record.Name);
        Assert.Equal(7, record.BlueprintId);
        Assert.Null(store.Get(saved.Id + 1000));
    }

    public static void Lists_AreScopedByHost_AndNewestFirst(ISavedConfigStore store)
    {
        store.Save("https://example.com/a", "First", "{}");
        Thread.Sleep(5);
        store.Save("https://example.com/b", "Second", "{}");
        store.Save("https://other.example.org/", "Other", "{}");

        Assert.Equal(["Second", "First"], store.ListByUrl("https://example.com/x").Select(c => c.Name));
        Assert.Empty(store.ListByUrl("https://unknown.example/"));
        Assert.Equal(3, store.ListAll().Count);
        Assert.Equal("Other", store.ListAll()[0].Name);
    }

    public static void AnUnparsableUrl_FallsBackToTheRawStringAsHost(ISavedConfigStore store)
    {
        store.Save("not a url", "Odd", "{}");
        Assert.Single(store.ListByUrl("not a url"));
    }

    public static void Delete_ReportsWhetherTheIdExisted_AndRemovesItsOutputs(ISavedConfigStore store)
    {
        var config = store.Save("https://example.com", "C", "{}");
        var output = store.SaveOutput(config.Id, "run 1", "output.csv", "a,b\n1,2\n");

        Assert.True(store.Delete(config.Id));
        Assert.False(store.Delete(config.Id));
        Assert.Null(store.GetOutput(output.Id));
        Assert.Empty(store.ListOutputsByConfigId(config.Id));
    }

    public static void Outputs_SaveListGetDelete(ISavedConfigStore store)
    {
        var config = store.Save("https://example.com", "C", "{}");
        var csv = "x\n" + new string('y', 100_000);
        var first = store.SaveOutput(config.Id, "first", "output.csv", csv);
        Thread.Sleep(5);
        var second = store.SaveOutput(config.Id, "second", "output.json", "[]");

        Assert.Equal(["second", "first"], store.ListOutputsByConfigId(config.Id).Select(o => o.Name));
        Assert.Equal(csv, store.GetOutput(first.Id)!.Content);
        Assert.True(store.DeleteOutput(second.Id));
        Assert.False(store.DeleteOutput(second.Id));
    }

    public static void MostRecentOutput_ExcludesTheGivenOne_AndFollowsConfigOrBlueprint(ISavedConfigStore store)
    {
        var configA = store.Save("https://a.example", "A", "{}", blueprintId: 42);
        var configB = store.Save("https://b.example", "B", "{}", blueprintId: 42);
        var a1 = store.SaveOutput(configA.Id, "a1", "o.csv", "1");
        Thread.Sleep(5);
        var a2 = store.SaveOutput(configA.Id, "a2", "o.csv", "2");
        Thread.Sleep(5);
        var b1 = store.SaveOutput(configB.Id, "b1", "o.csv", "3");

        Assert.Equal(a1.Id, store.GetMostRecentOutputForConfig(configA.Id, excludeOutputId: a2.Id)!.Id);
        Assert.Null(store.GetMostRecentOutputForConfig(configB.Id, excludeOutputId: b1.Id));
        Assert.Equal(a2.Id, store.GetMostRecentOutputForBlueprint(42, excludeOutputId: b1.Id)!.Id);
        Assert.Null(store.GetMostRecentOutputForBlueprint(999, excludeOutputId: 0));
    }
}

internal static class OutputBlueprintStoreContract
{
    public static void Flat_SaveGetListUpdateDelete(IOutputBlueprintStore store)
    {
        var saved = store.Save("beta", "Flat", ["Titel", "Preis"], null);
        store.Save("Alpha", "Flat", ["A"], null);

        Assert.Equal(2, saved.FieldCount);
        Assert.Equal(["Alpha", "beta"], store.ListAll().Select(b => b.Name)); // case-insensitive by name
        var record = store.Get(saved.Id)!;
        Assert.Equal(["Titel", "Preis"], record.FieldNames);
        Assert.Equal("Flat", record.SchemaKind);
        Assert.Null(record.Tree);

        Assert.True(store.Update(saved.Id, "beta2", "Flat", ["Titel"], null));
        Assert.Equal(["Titel"], store.Get(saved.Id)!.FieldNames);
        // Writing the very same values again is still "found" (matched rows).
        Assert.True(store.Update(saved.Id, "beta2", "Flat", ["Titel"], null));
        Assert.False(store.Update(saved.Id + 1000, "x", "Flat", ["Titel"], null));

        Assert.True(store.Delete(saved.Id));
        Assert.False(store.Delete(saved.Id));
        Assert.Null(store.Get(saved.Id));
    }

    public static void Tree_RoundTripsAndCountsLeaves(IOutputBlueprintStore store)
    {
        List<OutputBlueprintTreeSchemaNode> tree =
        [
            new OutputBlueprintTreeSchemaField { Name = "Titel" },
            new OutputBlueprintTreeSchemaGroup
            {
                Name = "Artikel",
                Children = [new OutputBlueprintTreeSchemaField { Name = "Name" }, new OutputBlueprintTreeSchemaField { Name = "Preis" }],
            },
        ];
        var saved = store.Save("Tree", "Tree", null, tree);

        Assert.Equal(3, saved.FieldCount);
        Assert.Equal(3, store.ListAll().Single().FieldCount);
        var loaded = store.Get(saved.Id)!;
        Assert.Equal("Tree", loaded.SchemaKind);
        var group = Assert.IsType<OutputBlueprintTreeSchemaGroup>(loaded.Tree![1]);
        Assert.Equal(["Name", "Preis"], group.Children.Select(c => c.Name));
    }
}

internal static class TransformPresetStoreContract
{
    public static void SaveListRenameDelete(ITransformPresetStore store)
    {
        var saved = store.Save("zeta", [new TrimTransform()]);
        store.Save("Alpha", [new TrimTransform(), new ToNumberTransform()]);

        Assert.Equal(["Alpha", "zeta"], store.ListAll().Select(p => p.Name));
        Assert.Equal(2, store.ListAll()[0].Transforms.Count);
        Assert.IsType<ToNumberTransform>(store.ListAll()[0].Transforms[1]);
        Assert.True(store.Exists(saved.Id));
        Assert.False(store.Exists(saved.Id + 1000));

        Assert.True(store.Rename(saved.Id, "omega"));
        Assert.False(store.Rename(saved.Id + 1000, "x"));
        Assert.True(store.Delete(saved.Id));
        Assert.False(store.Delete(saved.Id));
        Assert.False(store.Exists(saved.Id));
    }

    public static void NameTaken_IsCaseInsensitive_AndCanIgnoreOneId(ITransformPresetStore store)
    {
        var saved = store.Save("Clean Price", [new TrimTransform()]);

        Assert.True(store.NameTaken("clean price"));
        Assert.True(store.NameTaken("CLEAN PRICE"));
        Assert.False(store.NameTaken("Clean Prices"));
        Assert.False(store.NameTaken("clean price", exceptId: saved.Id));
    }
}

// ── SQLite ───────────────────────────────────────────────────────────────────

public class SqliteStoreContractTests : IDisposable
{
    private readonly List<string> _files = [];

    private string NewDbPath()
    {
        var path = Path.Combine(Path.GetTempPath(), $"sf-contract-{Guid.NewGuid():N}.db");
        _files.Add(path);
        return path;
    }

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        foreach (var file in _files) if (File.Exists(file)) File.Delete(file);
    }

    private ISavedConfigStore Saved() => new SavedConfigStore(NewDbPath());
    private IOutputBlueprintStore Blueprints() => new OutputBlueprintStore(NewDbPath());
    private ITransformPresetStore Presets() => new TransformPresetStore(NewDbPath());

    [Fact] public void Saved_RoundTrip() => SavedConfigStoreContract.SaveAndGet_RoundTripsTheConfigVerbatim(Saved());
    [Fact] public void Saved_Lists() => SavedConfigStoreContract.Lists_AreScopedByHost_AndNewestFirst(Saved());
    [Fact] public void Saved_RawHost() => SavedConfigStoreContract.AnUnparsableUrl_FallsBackToTheRawStringAsHost(Saved());
    [Fact] public void Saved_Delete() => SavedConfigStoreContract.Delete_ReportsWhetherTheIdExisted_AndRemovesItsOutputs(Saved());
    [Fact] public void Saved_Outputs() => SavedConfigStoreContract.Outputs_SaveListGetDelete(Saved());
    [Fact] public void Saved_MostRecent() => SavedConfigStoreContract.MostRecentOutput_ExcludesTheGivenOne_AndFollowsConfigOrBlueprint(Saved());
    [Fact] public void Blueprints_Flat() => OutputBlueprintStoreContract.Flat_SaveGetListUpdateDelete(Blueprints());
    [Fact] public void Blueprints_Tree() => OutputBlueprintStoreContract.Tree_RoundTripsAndCountsLeaves(Blueprints());
    [Fact] public void Presets_Crud() => TransformPresetStoreContract.SaveListRenameDelete(Presets());
    [Fact] public void Presets_NameTaken() => TransformPresetStoreContract.NameTaken_IsCaseInsensitive_AndCanIgnoreOneId(Presets());
}

// ── MySQL ────────────────────────────────────────────────────────────────────

public class MySqlStoreContractTests
{
    private static void WithDatabase(Action<string> test)
    {
        using var database = new MySqlTestDatabase();
        test(StorageOptions.BuildMySqlConnectionString(
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                [StorageOptions.MySqlConnectionStringKey] = database.ConnectionString,
            }).Build()));
    }

    [MySqlFact] public void Saved_RoundTrip() => WithDatabase(c => SavedConfigStoreContract.SaveAndGet_RoundTripsTheConfigVerbatim(new MySqlSavedConfigStore(c)));
    [MySqlFact] public void Saved_Lists() => WithDatabase(c => SavedConfigStoreContract.Lists_AreScopedByHost_AndNewestFirst(new MySqlSavedConfigStore(c)));
    [MySqlFact] public void Saved_RawHost() => WithDatabase(c => SavedConfigStoreContract.AnUnparsableUrl_FallsBackToTheRawStringAsHost(new MySqlSavedConfigStore(c)));
    [MySqlFact] public void Saved_Delete() => WithDatabase(c => SavedConfigStoreContract.Delete_ReportsWhetherTheIdExisted_AndRemovesItsOutputs(new MySqlSavedConfigStore(c)));
    [MySqlFact] public void Saved_Outputs() => WithDatabase(c => SavedConfigStoreContract.Outputs_SaveListGetDelete(new MySqlSavedConfigStore(c)));
    [MySqlFact] public void Saved_MostRecent() => WithDatabase(c => SavedConfigStoreContract.MostRecentOutput_ExcludesTheGivenOne_AndFollowsConfigOrBlueprint(new MySqlSavedConfigStore(c)));
    [MySqlFact] public void Blueprints_Flat() => WithDatabase(c => OutputBlueprintStoreContract.Flat_SaveGetListUpdateDelete(new MySqlOutputBlueprintStore(c)));
    [MySqlFact] public void Blueprints_Tree() => WithDatabase(c => OutputBlueprintStoreContract.Tree_RoundTripsAndCountsLeaves(new MySqlOutputBlueprintStore(c)));
    [MySqlFact] public void Presets_Crud() => WithDatabase(c => TransformPresetStoreContract.SaveListRenameDelete(new MySqlTransformPresetStore(c)));
    [MySqlFact] public void Presets_NameTaken() => WithDatabase(c => TransformPresetStoreContract.NameTaken_IsCaseInsensitive_AndCanIgnoreOneId(new MySqlTransformPresetStore(c)));

    [MySqlFact]
    public void AllThreeStores_ShareOneDatabase_AndStartingTwiceIsIdempotent() => WithDatabase(connectionString =>
    {
        var first = new MySqlSavedConfigStore(connectionString);
        var saved = first.Save("https://example.com", "kept", "{}");
        _ = new MySqlOutputBlueprintStore(connectionString);
        _ = new MySqlTransformPresetStore(connectionString);

        // A second start (new process) re-runs the schema creation/migrations.
        var second = new MySqlSavedConfigStore(connectionString);
        _ = new MySqlOutputBlueprintStore(connectionString);
        Assert.Equal("kept", second.Get(saved.Id)!.Name);
    });

    [MySqlFact]
    public void ADatabaseFromAnOlderBuild_GetsTheLaterColumnsAdded() => WithDatabase(connectionString =>
    {
        // The tables as the first version of this store created them — without
        // SavedConfigs.BlueprintId and OutputBlueprints.SchemaKind/TreeJson.
        using (var connection = new MySqlConnection(connectionString))
        {
            connection.Open();
            foreach (var sql in new[]
            {
                "CREATE TABLE SavedConfigs (Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, Url TEXT NOT NULL, Host VARCHAR(255) NOT NULL, Name TEXT NOT NULL, SavedAt VARCHAR(40) NOT NULL, ConfigJson LONGTEXT NOT NULL);",
                "CREATE TABLE OutputBlueprints (Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, Name TEXT NOT NULL, SavedAt VARCHAR(40) NOT NULL, FieldNamesJson LONGTEXT NOT NULL);",
                "INSERT INTO SavedConfigs (Url, Host, Name, SavedAt, ConfigJson) VALUES ('https://old.example', 'old.example', 'old', '2026-01-01T00:00:00.0000000+00:00', '{}');",
                "INSERT INTO OutputBlueprints (Name, SavedAt, FieldNamesJson) VALUES ('old', '2026-01-01T00:00:00.0000000+00:00', '[\"A\"]');",
            })
            {
                using var command = connection.CreateCommand();
                command.CommandText = sql;
                command.ExecuteNonQuery();
            }
        }

        var configs = new MySqlSavedConfigStore(connectionString);
        var blueprints = new MySqlOutputBlueprintStore(connectionString);

        Assert.Null(configs.ListAll().Single().BlueprintId);
        Assert.Equal("Flat", blueprints.ListAll().Single().SchemaKind); // the default for pre-existing rows
        Assert.Equal(7, configs.Get(configs.Save("https://new.example", "new", "{}", blueprintId: 7).Id)!.BlueprintId);
    });
}
