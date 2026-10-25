using System.Data.Common;
using System.Text.Json;
using System.Text.Json.Serialization;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Companion.Storage;

// ITransformPresetStore written once for both databases. TransformsJson holds the chain in its wire shape (camelCase, the
// polymorphic "kind" tag, string enums); the endpoint validates a typed chain before it gets here.
public abstract class SqlTransformPresetStoreBase : SqlStore, ITransformPresetStore
{
    private static readonly JsonSerializerOptions TransformsJsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    // SQL condition "this row's Name equals @name, ignoring case" (but not accents, so both databases agree).
    protected abstract string NameEqualsSql { get; }

    // ORDER BY expression giving the case-insensitive name order.
    protected abstract string NameOrderBy { get; }

    private static string Serialize(List<FieldTransform> transforms) => JsonSerializer.Serialize(transforms, TransformsJsonOptions);

    private static List<FieldTransform> Deserialize(string json) => JsonSerializer.Deserialize<List<FieldTransform>>(json, TransformsJsonOptions)!;

    public TransformPresetSummary Save(string name, List<FieldTransform> transforms, long ownerId = 0)
    {
        var savedAt = DateTimeOffset.UtcNow.ToString("O");
        using var connection = OpenConnection();
        var id = Insert(connection,
            "INSERT INTO TransformPresets (Name, SavedAt, TransformsJson, OwnerId) VALUES (@name, @savedAt, @transformsJson, @ownerId);",
            ("@name", name), ("@savedAt", savedAt), ("@transformsJson", Serialize(transforms)), ("@ownerId", ownerId));
        return new TransformPresetSummary(id, name, savedAt, transforms);
    }

    // The full chain is included (it is tiny) so the picker can apply a preset without a second round trip.
    public IReadOnlyList<TransformPresetSummary> ListAll(long ownerId = 0)
    {
        using var connection = OpenConnection();
        return Query(connection,
            $"SELECT Id, Name, SavedAt, TransformsJson FROM TransformPresets WHERE OwnerId = @ownerId ORDER BY {NameOrderBy};",
            reader => new TransformPresetSummary(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), Deserialize(reader.GetString(3))),
            ("@ownerId", ownerId));
    }

    public bool Exists(long id, long ownerId = 0)
    {
        using var connection = OpenConnection();
        return Count(connection, "SELECT COUNT(*) FROM TransformPresets WHERE Id = @id AND OwnerId = @ownerId;", ("@id", id), ("@ownerId", ownerId)) > 0;
    }

    // Names are what the user picks presets by, so two sharing one would make the picker ambiguous.
    public bool NameTaken(string name, long? exceptId = null, long ownerId = 0)
    {
        using var connection = OpenConnection();
        return Count(connection,
            $"SELECT COUNT(*) FROM TransformPresets WHERE {NameEqualsSql} AND OwnerId = @ownerId AND (@exceptId IS NULL OR Id <> @exceptId);",
            ("@name", name), ("@ownerId", ownerId), ("@exceptId", exceptId)) > 0;
    }

    // Rename only: a chain is changed by saving a rebuilt one, so there is no second transform editor to keep in sync.
    public bool Rename(long id, string name, long ownerId = 0)
    {
        using var connection = OpenConnection();
        return Execute(connection, "UPDATE TransformPresets SET Name = @name WHERE Id = @id AND OwnerId = @ownerId;",
            ("@id", id), ("@ownerId", ownerId), ("@name", name)) > 0;
    }

    public bool Delete(long id, long ownerId = 0)
    {
        using var connection = OpenConnection();
        return Execute(connection, "DELETE FROM TransformPresets WHERE Id = @id AND OwnerId = @ownerId;", ("@id", id), ("@ownerId", ownerId)) > 0;
    }

    public int ClaimUnowned(long ownerId)
    {
        using var connection = OpenConnection();
        return Execute(connection, "UPDATE TransformPresets SET OwnerId = @ownerId WHERE OwnerId = 0;", ("@ownerId", ownerId));
    }
}
