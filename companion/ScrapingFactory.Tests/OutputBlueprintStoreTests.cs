using ScrapingFactory.Companion;
using ScrapingFactory.Compiler.IR;
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

    // Issue #244: every pre-existing test below still exercises the "flat"
    // schema kind exactly as it did before SchemaKind/Tree existed — these
    // two helpers just thread the new required parameters through so none
    // of that byte-for-byte existing coverage needed to change.
    private OutputBlueprintSummary SaveFlat(string name, List<string> fieldNames) =>
        _store.Save(name, "Flat", fieldNames, null);

    private bool UpdateFlat(long id, string name, List<string> fieldNames) =>
        _store.Update(id, name, "Flat", fieldNames, null);

    [Fact]
    public void Save_ThenGet_ReturnsFullRecordIncludingFieldNames()
    {
        var saved = SaveFlat("Product schema", ["Title", "Price", "Sku"]);

        var record = _store.Get(saved.Id);

        Assert.NotNull(record);
        Assert.Equal("Product schema", record!.Name);
        Assert.Equal(["Title", "Price", "Sku"], record.FieldNames);
        Assert.Equal("Flat", record.SchemaKind);
        Assert.Null(record.Tree);
    }

    [Fact]
    public void Get_UnknownId_ReturnsNull()
    {
        Assert.Null(_store.Get(999999));
    }

    [Fact]
    public void ListAll_OrdersByNameCaseInsensitively()
    {
        SaveFlat("banana schema", ["A"]);
        SaveFlat("Apple schema", ["B"]);

        var results = _store.ListAll();

        Assert.Equal(["Apple schema", "banana schema"], results.Select(r => r.Name));
    }

    [Fact]
    public void ListAll_ReflectsFieldCount()
    {
        SaveFlat("Schema", ["A", "B", "C"]);

        var results = _store.ListAll();

        Assert.Equal(3, results[0].FieldCount);
    }

    [Fact]
    public void Update_ExistingId_ChangesNameAndFieldNames()
    {
        var saved = SaveFlat("Old name", ["A"]);

        var updated = UpdateFlat(saved.Id, "New name", ["A", "B"]);

        Assert.True(updated);
        var record = _store.Get(saved.Id);
        Assert.Equal("New name", record!.Name);
        Assert.Equal(["A", "B"], record.FieldNames);
    }

    [Fact]
    public void Update_UnknownId_ReturnsFalse()
    {
        Assert.False(UpdateFlat(999999, "Name", ["A"]));
    }

    [Fact]
    public void Delete_ExistingId_RemovesItAndReturnsTrue()
    {
        var saved = SaveFlat("Schema", ["A"]);

        var deleted = _store.Delete(saved.Id);

        Assert.True(deleted);
        Assert.Null(_store.Get(saved.Id));
    }

    [Fact]
    public void Delete_UnknownId_ReturnsFalse()
    {
        Assert.False(_store.Delete(999999));
    }

    // Issue #244: a tree-kind blueprint stores/round-trips its own nested
    // target schema instead of a flat field list.
    [Fact]
    public void Save_TreeSchema_ThenGet_ReturnsFullRecordIncludingTree()
    {
        var tree = new List<OutputBlueprintTreeSchemaNode>
        {
            new OutputBlueprintTreeSchemaGroup
            {
                Name = "Kategorien",
                Children =
                [
                    new OutputBlueprintTreeSchemaField { Name = "Name" },
                    new OutputBlueprintTreeSchemaGroup
                    {
                        Name = "Gerichte",
                        Children = [new OutputBlueprintTreeSchemaField { Name = "Preis" }],
                    },
                ],
            },
        };

        var saved = _store.Save("Menu schema", "Tree", null, tree);

        var record = _store.Get(saved.Id);

        Assert.NotNull(record);
        Assert.Equal("Tree", record!.SchemaKind);
        Assert.NotNull(record.Tree);
        var root = Assert.IsType<OutputBlueprintTreeSchemaGroup>(Assert.Single(record.Tree!));
        Assert.Equal("Kategorien", root.Name);
        Assert.Equal(2, root.Children.Count);
        Assert.IsType<OutputBlueprintTreeSchemaField>(root.Children[0]);
        var nested = Assert.IsType<OutputBlueprintTreeSchemaGroup>(root.Children[1]);
        Assert.Equal("Gerichte", nested.Name);
    }

    // FieldCount for a tree-kind blueprint is the total LEAF count across
    // the whole tree, recursively — 2 leaves here ("Name" and "Preis"),
    // even though the tree also contains one group node.
    [Fact]
    public void ListAll_TreeSchema_ReflectsLeafFieldCount()
    {
        var tree = new List<OutputBlueprintTreeSchemaNode>
        {
            new OutputBlueprintTreeSchemaGroup
            {
                Name = "Kategorien",
                Children =
                [
                    new OutputBlueprintTreeSchemaField { Name = "Name" },
                    new OutputBlueprintTreeSchemaGroup
                    {
                        Name = "Gerichte",
                        Children = [new OutputBlueprintTreeSchemaField { Name = "Preis" }],
                    },
                ],
            },
        };
        _store.Save("Menu schema", "Tree", null, tree);

        var results = _store.ListAll();

        Assert.Equal("Tree", results[0].SchemaKind);
        Assert.Equal(2, results[0].FieldCount);
    }

    [Fact]
    public void Update_FlatToTreeSchema_SwitchesSchemaKind()
    {
        var saved = SaveFlat("Schema", ["A"]);
        var tree = new List<OutputBlueprintTreeSchemaNode> { new OutputBlueprintTreeSchemaField { Name = "A" } };

        var updated = _store.Update(saved.Id, "Schema", "Tree", null, tree);

        Assert.True(updated);
        var record = _store.Get(saved.Id);
        Assert.Equal("Tree", record!.SchemaKind);
        Assert.NotNull(record.Tree);
    }
}
