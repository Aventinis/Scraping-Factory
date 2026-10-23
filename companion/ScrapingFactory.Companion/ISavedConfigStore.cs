namespace ScrapingFactory.Companion;

// The storage contract behind the /configs endpoints (saved configurations and their saved run outputs). The endpoint
// handlers (Endpoints/) depend on this instead of a database; SavedConfigStore (SQLite) and MySqlSavedConfigStore implement
// it through SqlSavedConfigStoreBase, which holds the queries. Deliberately limited to what the handlers call: connection
// strings, PRAGMAs, migrations and ResolveDbPath stay inside the implementations.
//
// Contract notes an implementation must keep, because the endpoints rely on
// them: ConfigJson/Content are stored and returned verbatim (never
// re-serialized); deleting a configuration also deletes its saved outputs;
// lists are newest first; "not found" is null/false, never an exception;
// GetMostRecentOutput* never returns excludeOutputId itself.
//
// Issue #278 — ownership: every member takes the owning user's id (default 0 =
// a companion without authentication, i.e. "nobody in particular"); an
// implementation only ever returns/changes rows of that owner, and "not found"
// also covers "belongs to someone else". Saved outputs are scoped through
// their configuration. SaveOutput throws KeyNotFoundException when the
// configuration does not exist for that owner.
public interface ISavedConfigStore
{
    SavedConfigSummary Save(string url, string name, string configJson, long? blueprintId = null, long ownerId = 0);

    // Every saved configuration for url's hostname (summary only, no config).
    IReadOnlyList<SavedConfigSummary> ListByUrl(string url, long ownerId = 0);

    // Every saved configuration regardless of host (Issue #239).
    IReadOnlyList<SavedConfigSummary> ListAll(long ownerId = 0);

    SavedConfigRecord? Get(long id, long ownerId = 0);

    bool Delete(long id, long ownerId = 0);

    SavedOutputSummary SaveOutput(long savedConfigId, string name, string fileName, string content, long ownerId = 0);

    IReadOnlyList<SavedOutputSummary> ListOutputsByConfigId(long savedConfigId, long ownerId = 0);

    SavedOutputRecord? GetOutput(long id, long ownerId = 0);

    bool DeleteOutput(long id, long ownerId = 0);

    // The next-most-recent saved output of the same configuration (Issue #207).
    SavedOutputSummary? GetMostRecentOutputForConfig(long savedConfigId, long excludeOutputId, long ownerId = 0);

    // The most recent saved output across every configuration sharing blueprintId.
    SavedOutputSummary? GetMostRecentOutputForBlueprint(long blueprintId, long excludeOutputId, long ownerId = 0);

    // Issue #278: assigns every configuration with owner 0 (saved while the
    // companion had no authentication) to a user; returns how many.
    int ClaimUnowned(long ownerId);
}
