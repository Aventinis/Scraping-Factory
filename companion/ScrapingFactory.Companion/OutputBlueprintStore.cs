using System.Data.Common;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using ScrapingFactory.Companion.Storage;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Companion;

// Output Blueprints: named, reusable target schemas, independent of any saved configuration (hence their own store).
// SchemaKind is "Flat" or "Tree" (PascalCase, like the wire enum, but a plain string to keep the persistence format
// independent of the IR type); it decides whether FieldNamesJson or TreeJson is meaningful. FieldCount counts the target
// leaves for either kind.
public sealed record OutputBlueprintSummary(long Id, string Name, string SavedAt, int FieldCount, string SchemaKind);

public sealed record OutputBlueprintRecord(
    long Id, string Name, string SavedAt, List<string> FieldNames, string SchemaKind, List<OutputBlueprintTreeSchemaNode>? Tree);

// SQLite backend of IOutputBlueprintStore (output-blueprints.db, Companion:OutputBlueprintsDbPath). The queries are in
// SqlOutputBlueprintStoreBase.
public sealed class OutputBlueprintStore : SqlOutputBlueprintStoreBase
{
    private readonly string _connectionString;

    public OutputBlueprintStore(IConfiguration configuration)
        : this(ResolveDbPath(configuration))
    {
    }

    public OutputBlueprintStore(string dbPath)
    {
        _connectionString = new SqliteConnectionStringBuilder { DataSource = dbPath }.ToString();
        EnsureCreated();
    }

    public static string ResolveDbPath(IConfiguration configuration)
    {
        var configured = configuration["Companion:OutputBlueprintsDbPath"];
        if (!string.IsNullOrWhiteSpace(configured))
            return configured;

        var appDataDir = Environment.GetFolderPath(
            Environment.SpecialFolder.ApplicationData, Environment.SpecialFolderOption.Create);
        var dir = Path.Combine(appDataDir, "ScrapingFactory");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, "output-blueprints.db");
    }

    protected override DbConnection OpenConnection() => SqliteSchema.Open(_connectionString);

    protected override string LastInsertIdSql => "SELECT last_insert_rowid();";

    protected override string NameOrderBy => "Name COLLATE NOCASE";

    private void EnsureCreated()
    {
        using var connection = SqliteSchema.Open(_connectionString);
        SqliteSchema.Execute(connection, """
            CREATE TABLE IF NOT EXISTS OutputBlueprints (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                Name TEXT NOT NULL,
                SavedAt TEXT NOT NULL,
                FieldNamesJson TEXT NOT NULL
            );
            """);
        // Every row from before tree schemas is a flat one.
        SqliteSchema.EnsureColumn(connection, "OutputBlueprints", "SchemaKind", "TEXT NOT NULL DEFAULT 'Flat'");
        SqliteSchema.EnsureColumn(connection, "OutputBlueprints", "TreeJson", "TEXT NULL");
        SqliteSchema.EnsureColumn(connection, "OutputBlueprints", "OwnerId", "INTEGER NOT NULL DEFAULT 0");
    }
}
