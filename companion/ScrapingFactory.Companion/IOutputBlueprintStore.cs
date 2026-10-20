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
    OutputBlueprintSummary Save(string name, string schemaKind, List<string>? fieldNames, List<OutputBlueprintTreeSchemaNode>? tree);

    IReadOnlyList<OutputBlueprintSummary> ListAll();

    OutputBlueprintRecord? Get(long id);

    bool Update(long id, string name, string schemaKind, List<string>? fieldNames, List<OutputBlueprintTreeSchemaNode>? tree);

    bool Delete(long id);
}
