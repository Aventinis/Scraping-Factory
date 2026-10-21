using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Companion;

// Issue #276: the storage contract behind the /transform-presets endpoints
// (Issue #279) — see ISavedConfigStore for why the endpoint handlers depend on
// an interface and what stays inside the SQLite implementation
// (TransformPresetStore). Names are unique case-insensitively (NameTaken); the
// endpoints validate the chain before calling Save; "not found" is false,
// never an exception.
public interface ITransformPresetStore
{
    TransformPresetSummary Save(string name, List<FieldTransform> transforms, long ownerId = 0);

    // Every preset, chain included, ordered by name.
    IReadOnlyList<TransformPresetSummary> ListAll(long ownerId = 0);

    bool Exists(long id, long ownerId = 0);

    bool NameTaken(string name, long? exceptId = null, long ownerId = 0);

    bool Rename(long id, string name, long ownerId = 0);

    bool Delete(long id, long ownerId = 0);

    // Issue #278: see ISavedConfigStore — every member is scoped to an owner
    // (default 0 = no authentication), and names are unique per owner;
    // ClaimUnowned assigns owner-0 rows to a user.
    int ClaimUnowned(long ownerId);
}
