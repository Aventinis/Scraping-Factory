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
    TransformPresetSummary Save(string name, List<FieldTransform> transforms);

    // Every preset, chain included, ordered by name.
    IReadOnlyList<TransformPresetSummary> ListAll();

    bool Exists(long id);

    bool NameTaken(string name, long? exceptId = null);

    bool Rename(long id, string name);

    bool Delete(long id);
}
