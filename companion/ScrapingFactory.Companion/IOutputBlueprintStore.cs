using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Companion;

// Issue #276: the storage contract behind the /blueprints endpoints (Output
// Blueprints, Issues #191/#244) — see ISavedConfigStore for why the endpoint
// handlers depend on an interface and what stays inside the SQLite
// implementation (OutputBlueprintStore). schemaKind is the PascalCase string
// "Flat"/"Tree"; FieldCount in summaries counts leaf fields for a tree; "not
// found" is null/false, never an exception.
public interface IOutputBlueprintStore
{
    OutputBlueprintSummary Save(string name, string schemaKind, List<string>? fieldNames, List<OutputBlueprintTreeSchemaNode>? tree, long ownerId = 0);

    IReadOnlyList<OutputBlueprintSummary> ListAll(long ownerId = 0);

    OutputBlueprintRecord? Get(long id, long ownerId = 0);

    bool Update(long id, string name, string schemaKind, List<string>? fieldNames, List<OutputBlueprintTreeSchemaNode>? tree, long ownerId = 0);

    bool Delete(long id, long ownerId = 0);

    // Issue #278: see ISavedConfigStore — every member is scoped to an owner
    // (default 0 = no authentication); ClaimUnowned assigns owner-0 rows to a user.
    int ClaimUnowned(long ownerId);
}
