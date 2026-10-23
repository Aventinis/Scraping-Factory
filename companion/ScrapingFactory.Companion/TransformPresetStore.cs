using System.Data.Common;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using ScrapingFactory.Companion.Storage;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Companion;

// Reusable, named transform chains ("transform presets"): cross-site by nature, so their own store with no relationship to a
// saved configuration (like Output Blueprints).
public sealed record TransformPresetSummary(long Id, string Name, string SavedAt, List<FieldTransform> Transforms);

// SQLite backend of ITransformPresetStore (transform-presets.db, Companion:TransformPresetsDbPath). The queries are in
// SqlTransformPresetStoreBase.
public sealed class TransformPresetStore : SqlTransformPresetStoreBase
{
    private readonly string _connectionString;

    public TransformPresetStore(IConfiguration configuration)
        : this(ResolveDbPath(configuration))
    {
    }

    public TransformPresetStore(string dbPath)
    {
        _connectionString = new SqliteConnectionStringBuilder { DataSource = dbPath }.ToString();
        EnsureCreated();
    }

    public static string ResolveDbPath(IConfiguration configuration)
    {
        var configured = configuration["Companion:TransformPresetsDbPath"];
        if (!string.IsNullOrWhiteSpace(configured))
            return configured;

        var appDataDir = Environment.GetFolderPath(
            Environment.SpecialFolder.ApplicationData, Environment.SpecialFolderOption.Create);
        var dir = Path.Combine(appDataDir, "ScrapingFactory");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, "transform-presets.db");
    }

    protected override DbConnection OpenConnection() => SqliteSchema.Open(_connectionString);

    protected override string LastInsertIdSql => "SELECT last_insert_rowid();";

    protected override string NameEqualsSql => "Name = @name COLLATE NOCASE";

    protected override string NameOrderBy => "Name COLLATE NOCASE";

    private void EnsureCreated()
    {
        using var connection = SqliteSchema.Open(_connectionString);
        SqliteSchema.Execute(connection, """
            CREATE TABLE IF NOT EXISTS TransformPresets (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                Name TEXT NOT NULL,
                SavedAt TEXT NOT NULL,
                TransformsJson TEXT NOT NULL
            );
            """);
        SqliteSchema.EnsureColumn(connection, "TransformPresets", "OwnerId", "INTEGER NOT NULL DEFAULT 0");
    }
}
