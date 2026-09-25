using ScrapingFactory.Companion;
using Xunit;

namespace ScrapingFactory.Tests;

public class OutputBlueprintStoreTests : IDisposable
{
    private readonly string _dbPath;
    private readonly OutputBlueprintStore _store;

    public OutputBlueprintStoreTests()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"sf-output-blueprints-test-{Guid.NewGuid():N}.db");
        _store = new OutputBlueprintStore(_dbPath);
    }

    public void Dispose()
    {
        if (File.Exists(_dbPath)) File.Delete(_dbPath);
    }

    [Fact]
    public void Save_ThenGet_ReturnsFullRecordIncludingFieldNames()
    {
        var saved = _store.Save("Product schema", ["Title", "Price", "Sku"]);

        var record = _store.Get(saved.Id);

        Assert.NotNull(record);
        Assert.Equal("Product schema", record!.Name);
        Assert.Equal(["Title", "Price", "Sku"], record.FieldNames);
    }

    [Fact]
    public void Get_UnknownId_ReturnsNull()
    {
        Assert.Null(_store.Get(999999));
    }

    [Fact]
    public void ListAll_OrdersByNameCaseInsensitively()
    {
        _store.Save("banana schema", ["A"]);
        _store.Save("Apple schema", ["B"]);

        var results = _store.ListAll();

        Assert.Equal(["Apple schema", "banana schema"], results.Select(r => r.Name));
    }

    [Fact]
    public void ListAll_ReflectsFieldCount()
    {
        _store.Save("Schema", ["A", "B", "C"]);

        var results = _store.ListAll();

        Assert.Equal(3, results[0].FieldCount);
    }

    [Fact]
    public void Update_ExistingId_ChangesNameAndFieldNames()
    {
        var saved = _store.Save("Old name", ["A"]);

        var updated = _store.Update(saved.Id, "New name", ["A", "B"]);

        Assert.True(updated);
        var record = _store.Get(saved.Id);
        Assert.Equal("New name", record!.Name);
        Assert.Equal(["A", "B"], record.FieldNames);
    }

    [Fact]
    public void Update_UnknownId_ReturnsFalse()
    {
        Assert.False(_store.Update(999999, "Name", ["A"]));
    }

    [Fact]
    public void Delete_ExistingId_RemovesItAndReturnsTrue()
    {
        var saved = _store.Save("Schema", ["A"]);

        var deleted = _store.Delete(saved.Id);

        Assert.True(deleted);
        Assert.Null(_store.Get(saved.Id));
    }

    [Fact]
    public void Delete_UnknownId_ReturnsFalse()
    {
        Assert.False(_store.Delete(999999));
    }
}
