namespace ScrapingFactory.Companion;

// Issue #276: the storage contract behind the /configs endpoints (saved
// configurations, Issue #141, and their saved run outputs, Issue #202), so
// Program.cs's endpoint handlers depend on this instead of on the SQLite
// implementation (SavedConfigStore) — another backend only has to implement
// these members and be registered in DI. Deliberately limited to what the
// handlers call: everything SQLite-specific (the connection string, PRAGMA
// foreign_keys, the idempotent column migrations, ResolveDbPath) stays inside
// SavedConfigStore, since a different backend has its own connection and
// migration story.
//
// Contract notes an implementation must keep, because the endpoints rely on
// them: ConfigJson/Content are stored and returned verbatim (never
// re-serialized); deleting a configuration also deletes its saved outputs;
// lists are newest first; "not found" is null/false, never an exception;
// GetMostRecentOutput* never returns excludeOutputId itself.
public interface ISavedConfigStore
{
    SavedConfigSummary Save(string url, string name, string configJson, long? blueprintId = null);

    // Every saved configuration for url's hostname (summary only, no config).
    IReadOnlyList<SavedConfigSummary> ListByUrl(string url);

    // Every saved configuration regardless of host (Issue #239).
    IReadOnlyList<SavedConfigSummary> ListAll();

    SavedConfigRecord? Get(long id);

    bool Delete(long id);

    SavedOutputSummary SaveOutput(long savedConfigId, string name, string fileName, string content);

    IReadOnlyList<SavedOutputSummary> ListOutputsByConfigId(long savedConfigId);

    SavedOutputRecord? GetOutput(long id);

    bool DeleteOutput(long id);

    // The next-most-recent saved output of the same configuration (Issue #207).
    SavedOutputSummary? GetMostRecentOutputForConfig(long savedConfigId, long excludeOutputId);

    // The most recent saved output across every configuration sharing blueprintId.
    SavedOutputSummary? GetMostRecentOutputForBlueprint(long blueprintId, long excludeOutputId);
}
