using ScrapingFactory.Companion;
using Xunit;

namespace ScrapingFactory.Tests;

public class SavedConfigStoreTests : IDisposable
{
    private readonly string _dbPath;
    private readonly SavedConfigStore _store;

    public SavedConfigStoreTests()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"sf-saved-configs-test-{Guid.NewGuid():N}.db");
        _store = new SavedConfigStore(_dbPath);
    }

    public void Dispose()
    {
        if (File.Exists(_dbPath)) File.Delete(_dbPath);
    }

    [Fact]
    public void Save_ThenListByUrl_SameHost_ReturnsIt()
    {
        _store.Save("https://example.com/products", "My config", """{"url":"https://example.com/products"}""");

        var results = _store.ListByUrl("https://example.com/other-page");

        Assert.Single(results);
        Assert.Equal("My config", results[0].Name);
    }

    [Fact]
    public void ListByUrl_DifferentHost_ReturnsEmpty()
    {
        _store.Save("https://example.com/products", "My config", "{}");

        var results = _store.ListByUrl("https://other-site.com/");

        Assert.Empty(results);
    }

    [Fact]
    public void ListByUrl_OrdersNewestFirst()
    {
        _store.Save("https://example.com/a", "First", "{}");
        Thread.Sleep(5);
        _store.Save("https://example.com/b", "Second", "{}");

        var results = _store.ListByUrl("https://example.com/");

        Assert.Equal(["Second", "First"], results.Select(r => r.Name));
    }

    // Issue #239: ListAll is the unscoped counterpart to ListByUrl — every
    // saved config regardless of host, needed by Combined mode's component
    // picker (a component can come from any previously-scraped site).
    [Fact]
    public void ListAll_ReturnsSavedConfigsAcrossDifferentHosts()
    {
        _store.Save("https://example.com/a", "First", "{}");
        Thread.Sleep(5);
        _store.Save("https://other-site.com/b", "Second", "{}");

        var results = _store.ListAll();

        Assert.Equal(["Second", "First"], results.Select(r => r.Name));
    }

    [Fact]
    public void Get_ReturnsFullRecordIncludingConfigJson()
    {
        var saved = _store.Save("https://example.com/products", "My config", """{"fields":[]}""");

        var record = _store.Get(saved.Id);

        Assert.NotNull(record);
        Assert.Equal("My config", record!.Name);
        Assert.Equal("""{"fields":[]}""", record.ConfigJson);
    }

    [Fact]
    public void Get_UnknownId_ReturnsNull()
    {
        Assert.Null(_store.Get(999999));
    }

    [Fact]
    public void Delete_ExistingId_RemovesItAndReturnsTrue()
    {
        var saved = _store.Save("https://example.com/products", "My config", "{}");

        var deleted = _store.Delete(saved.Id);

        Assert.True(deleted);
        Assert.Null(_store.Get(saved.Id));
    }

    [Fact]
    public void Delete_UnknownId_ReturnsFalse()
    {
        Assert.False(_store.Delete(999999));
    }

    [Fact]
    public void Save_UnparseableUrl_StillRoundTripsConsistently()
    {
        _store.Save("not-a-real-url", "My config", "{}");

        var results = _store.ListByUrl("not-a-real-url");

        Assert.Single(results);
    }

    // Issue #202: SavedOutputs, linked to a SavedConfig.

    [Fact]
    public void SaveOutput_ThenListOutputsByConfigId_ReturnsIt()
    {
        var config = _store.Save("https://example.com/products", "My config", "{}");

        _store.SaveOutput(config.Id, "First run", "output.csv", "Titel\nA\n");

        var results = _store.ListOutputsByConfigId(config.Id);
        Assert.Single(results);
        Assert.Equal("First run", results[0].Name);
        Assert.Equal("output.csv", results[0].FileName);
        Assert.Equal(config.Id, results[0].SavedConfigId);
    }

    [Fact]
    public void ListOutputsByConfigId_DifferentConfig_ReturnsEmpty()
    {
        var configA = _store.Save("https://example.com/a", "Config A", "{}");
        var configB = _store.Save("https://example.com/b", "Config B", "{}");
        _store.SaveOutput(configA.Id, "Run", "output.csv", "Titel\nA\n");

        var results = _store.ListOutputsByConfigId(configB.Id);

        Assert.Empty(results);
    }

    [Fact]
    public void ListOutputsByConfigId_OrdersNewestFirst()
    {
        var config = _store.Save("https://example.com", "Config", "{}");
        _store.SaveOutput(config.Id, "First", "output.csv", "a");
        Thread.Sleep(5);
        _store.SaveOutput(config.Id, "Second", "output.csv", "b");

        var results = _store.ListOutputsByConfigId(config.Id);

        Assert.Equal(["Second", "First"], results.Select(r => r.Name));
    }

    [Fact]
    public void GetOutput_ReturnsFullRecordIncludingContent()
    {
        var config = _store.Save("https://example.com", "Config", "{}");
        var saved = _store.SaveOutput(config.Id, "Run", "output.csv", "Titel\nA\nB\n");

        var record = _store.GetOutput(saved.Id);

        Assert.NotNull(record);
        Assert.Equal("Run", record!.Name);
        Assert.Equal("output.csv", record.FileName);
        Assert.Equal("Titel\nA\nB\n", record.Content);
        Assert.Equal(config.Id, record.SavedConfigId);
    }

    [Fact]
    public void GetOutput_UnknownId_ReturnsNull()
    {
        Assert.Null(_store.GetOutput(999999));
    }

    [Fact]
    public void DeleteOutput_ExistingId_RemovesItAndReturnsTrue()
    {
        var config = _store.Save("https://example.com", "Config", "{}");
        var saved = _store.SaveOutput(config.Id, "Run", "output.csv", "a");

        var deleted = _store.DeleteOutput(saved.Id);

        Assert.True(deleted);
        Assert.Null(_store.GetOutput(saved.Id));
    }

    [Fact]
    public void DeleteOutput_UnknownId_ReturnsFalse()
    {
        Assert.False(_store.DeleteOutput(999999));
    }

    [Fact]
    public void Delete_SavedConfig_CascadesToItsOwnSavedOutputs()
    {
        var config = _store.Save("https://example.com", "Config", "{}");
        var saved = _store.SaveOutput(config.Id, "Run", "output.csv", "a");

        _store.Delete(config.Id);

        Assert.Null(_store.GetOutput(saved.Id));
    }

    // ── Issue #207: BlueprintId + baseline comparison-basis queries ────────

    [Fact]
    public void Save_WithBlueprintId_RoundTripsThroughGetAndListMethods()
    {
        var saved = _store.Save("https://example.com", "Config", "{}", blueprintId: 42);

        Assert.Equal(42, saved.BlueprintId);
        Assert.Equal(42, _store.Get(saved.Id)!.BlueprintId);
        Assert.Equal(42, _store.ListByUrl("https://example.com").Single().BlueprintId);
        Assert.Equal(42, _store.ListAll().Single().BlueprintId);
    }

    [Fact]
    public void Save_WithoutBlueprintId_DefaultsToNull()
    {
        var saved = _store.Save("https://example.com", "Config", "{}");

        Assert.Null(saved.BlueprintId);
        Assert.Null(_store.Get(saved.Id)!.BlueprintId);
    }

    [Fact]
    public void GetMostRecentOutputForConfig_ExcludesTheGivenOutputAndOtherConfigs()
    {
        var configA = _store.Save("https://a.com", "A", "{}");
        var configB = _store.Save("https://b.com", "B", "{}");
        var older = _store.SaveOutput(configA.Id, "Older", "output.csv", "a");
        Thread.Sleep(5);
        var newest = _store.SaveOutput(configA.Id, "Newest", "output.csv", "b");
        _store.SaveOutput(configB.Id, "Other config", "output.csv", "c");

        var result = _store.GetMostRecentOutputForConfig(configA.Id, excludeOutputId: newest.Id);

        Assert.NotNull(result);
        Assert.Equal(older.Id, result!.Id);
    }

    [Fact]
    public void GetMostRecentOutputForConfig_NoOtherOutput_ReturnsNull()
    {
        var config = _store.Save("https://example.com", "Config", "{}");
        var only = _store.SaveOutput(config.Id, "Only", "output.csv", "a");

        Assert.Null(_store.GetMostRecentOutputForConfig(config.Id, excludeOutputId: only.Id));
    }

    [Fact]
    public void GetMostRecentOutputForBlueprint_FindsNewestAcrossDifferentConfigsSharingTheBlueprint()
    {
        var configA = _store.Save("https://a.com", "A", "{}", blueprintId: 7);
        var configB = _store.Save("https://b.com", "B", "{}", blueprintId: 7);
        var configC = _store.Save("https://c.com", "C (different blueprint)", "{}", blueprintId: 9);
        var olderA = _store.SaveOutput(configA.Id, "Older A", "output.csv", "a");
        Thread.Sleep(5);
        var newestB = _store.SaveOutput(configB.Id, "Newest B", "output.csv", "b");
        var thisOutput = _store.SaveOutput(configA.Id, "This one, being evaluated", "output.csv", "c");
        _store.SaveOutput(configC.Id, "Different blueprint", "output.csv", "d");

        var result = _store.GetMostRecentOutputForBlueprint(7, excludeOutputId: thisOutput.Id);

        Assert.NotNull(result);
        Assert.Equal(newestB.Id, result!.Id);
        Assert.NotEqual(olderA.Id, result.Id);
    }

    [Fact]
    public void GetMostRecentOutputForBlueprint_NoConfigSharesIt_ReturnsNull()
    {
        var config = _store.Save("https://example.com", "Config", "{}", blueprintId: 1);
        _store.SaveOutput(config.Id, "Output", "output.csv", "a");

        Assert.Null(_store.GetMostRecentOutputForBlueprint(999, excludeOutputId: -1));
    }
}
