using System.Data.Common;
using System.Text.Json;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Companion.Storage;

// IOutputBlueprintStore written once for both databases. FieldNamesJson holds the ordered flat target names; a "Tree"
// blueprint keeps its schema in TreeJson instead (FieldNamesJson then stays "[]").
public abstract class SqlOutputBlueprintStoreBase : SqlStore, IOutputBlueprintStore
{
    private const string Columns = "Id, Name, SavedAt, FieldNamesJson, SchemaKind, TreeJson";

    // ORDER BY expression giving the case-insensitive name order (SQLite needs a COLLATE, MySQL's default collation is).
    protected abstract string NameOrderBy { get; }

    private static readonly JsonSerializerOptions TreeJsonOptions = new()
    {
        Converters = { new OutputBlueprintTreeSchemaNodeJsonConverter() },
    };

    private static string SerializeFieldNames(IReadOnlyList<string> fieldNames) => JsonSerializer.Serialize(fieldNames);

    private static List<string> DeserializeFieldNames(string json) => JsonSerializer.Deserialize<List<string>>(json)!;

    private static string SerializeTree(List<OutputBlueprintTreeSchemaNode> tree) => JsonSerializer.Serialize(tree, TreeJsonOptions);

    private static List<OutputBlueprintTreeSchemaNode> DeserializeTree(string json) =>
        JsonSerializer.Deserialize<List<OutputBlueprintTreeSchemaNode>>(json, TreeJsonOptions)!;

    // FieldCount is the number of target leaves, so the picker shows one "N fields" hint for both schema kinds.
    private static int CountLeaves(IReadOnlyList<OutputBlueprintTreeSchemaNode> nodes) =>
        nodes.Sum(node => node is OutputBlueprintTreeSchemaGroup group ? CountLeaves(group.Children) : 1);

    private static object? TreeParameter(List<OutputBlueprintTreeSchemaNode>? tree) =>
        tree is { Count: > 0 } ? SerializeTree(tree) : null;

    private static OutputBlueprintSummary ReadSummary(DbDataReader reader)
    {
        var fieldCount = reader.IsDBNull(5)
            ? DeserializeFieldNames(reader.GetString(3)).Count
            : CountLeaves(DeserializeTree(reader.GetString(5)));
        return new OutputBlueprintSummary(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), fieldCount, reader.GetString(4));
    }

    public OutputBlueprintSummary Save(string name, string schemaKind, List<string>? fieldNames, List<OutputBlueprintTreeSchemaNode>? tree, long ownerId = 0)
    {
        var savedAt = DateTimeOffset.UtcNow.ToString("O");
        using var connection = OpenConnection();
        var id = Insert(connection,
            "INSERT INTO OutputBlueprints (Name, SavedAt, FieldNamesJson, SchemaKind, TreeJson, OwnerId) VALUES (@name, @savedAt, @fieldNamesJson, @schemaKind, @treeJson, @ownerId);",
            ("@name", name), ("@savedAt", savedAt), ("@fieldNamesJson", SerializeFieldNames(fieldNames ?? [])),
            ("@schemaKind", schemaKind), ("@treeJson", TreeParameter(tree)), ("@ownerId", ownerId));
        var fieldCount = tree is { Count: > 0 } ? CountLeaves(tree) : (fieldNames?.Count ?? 0);
        return new OutputBlueprintSummary(id, name, savedAt, fieldCount, schemaKind);
    }

    // Unscoped and ordered by name: a small, stable set the user picks from by name, not a history.
    public IReadOnlyList<OutputBlueprintSummary> ListAll(long ownerId = 0)
    {
        using var connection = OpenConnection();
        return Query(connection, $"SELECT {Columns} FROM OutputBlueprints WHERE OwnerId = @ownerId ORDER BY {NameOrderBy};",
            ReadSummary, ("@ownerId", ownerId));
    }

    public OutputBlueprintRecord? Get(long id, long ownerId = 0)
    {
        using var connection = OpenConnection();
        return QueryFirst(connection, $"SELECT {Columns} FROM OutputBlueprints WHERE Id = @id AND OwnerId = @ownerId;",
            reader => new OutputBlueprintRecord(
                reader.GetInt64(0), reader.GetString(1), reader.GetString(2), DeserializeFieldNames(reader.GetString(3)),
                reader.GetString(4), reader.IsDBNull(5) ? null : DeserializeTree(reader.GetString(5))),
            ("@id", id), ("@ownerId", ownerId));
    }

    // The id stays stable across edits (existing mappings reference it), and the schema kind may change on edit too.
    public bool Update(long id, string name, string schemaKind, List<string>? fieldNames, List<OutputBlueprintTreeSchemaNode>? tree, long ownerId = 0)
    {
        using var connection = OpenConnection();
        return Execute(connection,
            "UPDATE OutputBlueprints SET Name = @name, FieldNamesJson = @fieldNamesJson, SchemaKind = @schemaKind, TreeJson = @treeJson WHERE Id = @id AND OwnerId = @ownerId;",
            ("@id", id), ("@ownerId", ownerId), ("@name", name), ("@fieldNamesJson", SerializeFieldNames(fieldNames ?? [])),
            ("@schemaKind", schemaKind), ("@treeJson", TreeParameter(tree))) > 0;
    }

    public bool Delete(long id, long ownerId = 0)
    {
        using var connection = OpenConnection();
        return Execute(connection, "DELETE FROM OutputBlueprints WHERE Id = @id AND OwnerId = @ownerId;", ("@id", id), ("@ownerId", ownerId)) > 0;
    }

    public int ClaimUnowned(long ownerId)
    {
        using var connection = OpenConnection();
        return Execute(connection, "UPDATE OutputBlueprints SET OwnerId = @ownerId WHERE OwnerId = 0;", ("@ownerId", ownerId));
    }
}
