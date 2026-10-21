using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Companion;

// Issue #279: a small, independent local table of named, reusable transform
// chains ("transform presets") — a chain saved once (e.g. "trim, then convert
// the price to a number") can be applied to any field of any scrape in one
// action instead of re-adding each step. Same shape and reasoning as
// OutputBlueprintStore (Issue #191): cross-site by nature, so its own SQLite
// file in the per-user app-data directory, with no relationship to any one
// saved configuration. TransformsJson holds the chain in exactly its wire
// shape (camelCase keys, the polymorphic "kind" tag, string enums) — the
// endpoint binds and validates a typed List<FieldTransform> first, so what's
// stored here is always a well-formed chain the extension can drop straight
// into a field's own transform list.
public sealed record TransformPresetSummary(long Id, string Name, string SavedAt, List<FieldTransform> Transforms);

public sealed class TransformPresetStore : ITransformPresetStore
{
    private static readonly JsonSerializerOptions TransformsJsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

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

    // Companion:TransformPresetsDbPath (env var
    // Companion__TransformPresetsDbPath, or a test-only override) — the
    // same configuration-precedence pattern as OutputBlueprintStore's own
    // ResolveDbPath.
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

    private SqliteConnection OpenConnection()
    {
        var connection = new SqliteConnection(_connectionString);
        connection.Open();
        return connection;
    }

    private void EnsureCreated()
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS TransformPresets (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                Name TEXT NOT NULL,
                SavedAt TEXT NOT NULL,
                TransformsJson TEXT NOT NULL
            );
            """;
        command.ExecuteNonQuery();

        // Issue #278: the owning user (0 = a companion without authentication).
        using var check = connection.CreateCommand();
        check.CommandText = "SELECT COUNT(*) FROM pragma_table_info('TransformPresets') WHERE name = 'OwnerId';";
        if ((long)check.ExecuteScalar()! == 0)
        {
            using var alter = connection.CreateCommand();
            alter.CommandText = "ALTER TABLE TransformPresets ADD COLUMN OwnerId INTEGER NOT NULL DEFAULT 0;";
            alter.ExecuteNonQuery();
        }
    }

    internal static string Serialize(List<FieldTransform> transforms) => JsonSerializer.Serialize(transforms, TransformsJsonOptions);

    internal static List<FieldTransform> Deserialize(string json) => JsonSerializer.Deserialize<List<FieldTransform>>(json, TransformsJsonOptions)!;

    public TransformPresetSummary Save(string name, List<FieldTransform> transforms, long ownerId = 0)
    {
        var savedAt = DateTimeOffset.UtcNow.ToString("O");
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO TransformPresets (Name, SavedAt, TransformsJson, OwnerId) VALUES (@name, @savedAt, @transformsJson, @ownerId);
            SELECT last_insert_rowid();
            """;
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@savedAt", savedAt);
        command.Parameters.AddWithValue("@transformsJson", Serialize(transforms));
        command.Parameters.AddWithValue("@ownerId", ownerId);
        var id = (long)command.ExecuteScalar()!;
        return new TransformPresetSummary(id, name, savedAt, transforms);
    }

    // Unscoped and ordered by name, like OutputBlueprintStore.ListAll — a
    // small, stable set the user picks *from* by name. Unlike blueprints the
    // full chain is included right away (it's tiny), so the extension's
    // picker can apply a preset without a second round trip.
    public IReadOnlyList<TransformPresetSummary> ListAll(long ownerId = 0)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id, Name, SavedAt, TransformsJson FROM TransformPresets WHERE OwnerId = @ownerId ORDER BY Name COLLATE NOCASE;";
        command.Parameters.AddWithValue("@ownerId", ownerId);

        var results = new List<TransformPresetSummary>();
        using var reader = command.ExecuteReader();
        while (reader.Read())
            results.Add(new TransformPresetSummary(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), Deserialize(reader.GetString(3))));
        return results;
    }

    public bool Exists(long id, long ownerId = 0)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM TransformPresets WHERE Id = @id AND OwnerId = @ownerId;";
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@ownerId", ownerId);
        return (long)command.ExecuteScalar()! > 0;
    }

    // Case-insensitive, optionally ignoring one id (the preset being renamed
    // itself) — names are what the user picks presets by, so two presets
    // sharing one would make the picker ambiguous.
    public bool NameTaken(string name, long? exceptId = null, long ownerId = 0)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM TransformPresets WHERE Name = @name COLLATE NOCASE AND OwnerId = @ownerId AND (@exceptId IS NULL OR Id <> @exceptId);";
        command.Parameters.AddWithValue("@name", name);
        command.Parameters.AddWithValue("@ownerId", ownerId);
        command.Parameters.AddWithValue("@exceptId", exceptId.HasValue ? exceptId.Value : DBNull.Value);
        return (long)command.ExecuteScalar()! > 0;
    }

    // Rename only — a preset's steps are changed by building the chain on a
    // field and saving it again (Issue #279's own scope decision), so there's
    // no second transform editor to keep in sync.
    public bool Rename(long id, string name, long ownerId = 0)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE TransformPresets SET Name = @name WHERE Id = @id AND OwnerId = @ownerId;";
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@ownerId", ownerId);
        command.Parameters.AddWithValue("@name", name);
        return command.ExecuteNonQuery() > 0;
    }

    public bool Delete(long id, long ownerId = 0)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM TransformPresets WHERE Id = @id AND OwnerId = @ownerId;";
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@ownerId", ownerId);
        return command.ExecuteNonQuery() > 0;
    }

    // Issue #278: see SavedConfigStore.ClaimUnowned.
    public int ClaimUnowned(long ownerId)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE TransformPresets SET OwnerId = @ownerId WHERE OwnerId = 0;";
        command.Parameters.AddWithValue("@ownerId", ownerId);
        return command.ExecuteNonQuery();
    }
}
