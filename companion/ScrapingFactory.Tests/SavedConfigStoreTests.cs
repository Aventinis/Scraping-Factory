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
}
