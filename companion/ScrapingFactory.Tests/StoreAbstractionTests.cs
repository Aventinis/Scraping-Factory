using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using ScrapingFactory.Companion;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #276: the /configs, /blueprints and /transform-presets endpoint
// handlers depend on interfaces, not on the SQLite classes — proven by
// swapping each registration for an in-memory fake (no SQLite file involved)
// and by the SQLite classes being registered through the interfaces by default.
public class StoreAbstractionTests
{
    private static WebApplicationFactory<Program> WithServices(Action<IServiceCollection> configure) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.ConfigureServices(configure));

    [Fact]
    public void DefaultRegistrations_ResolveTheSqliteImplementationsByInterface()
    {
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseSetting("Companion:SavedConfigsDbPath", Path.Combine(Path.GetTempPath(), $"sf-abs-{Guid.NewGuid():N}.db"))
                .UseSetting("Companion:OutputBlueprintsDbPath", Path.Combine(Path.GetTempPath(), $"sf-abs-{Guid.NewGuid():N}.db"))
                .UseSetting("Companion:TransformPresetsDbPath", Path.Combine(Path.GetTempPath(), $"sf-abs-{Guid.NewGuid():N}.db")));

        Assert.IsType<SavedConfigStore>(factory.Services.GetRequiredService<ISavedConfigStore>());
        Assert.IsType<OutputBlueprintStore>(factory.Services.GetRequiredService<IOutputBlueprintStore>());
        Assert.IsType<TransformPresetStore>(factory.Services.GetRequiredService<ITransformPresetStore>());
        // Nothing is registered under the concrete types any more.
        Assert.Null(factory.Services.GetService<SavedConfigStore>());
    }

    [Fact]
    public async Task ConfigsEndpoints_UseWhateverISavedConfigStoreIsRegistered()
    {
        using var factory = WithServices(services => services.Replace(ServiceDescriptor.Singleton<ISavedConfigStore>(new FakeSavedConfigStore())));
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/configs?url=https://example.com/a");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var list = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("from the fake store", list[0].GetProperty("name").GetString());

        var one = await client.GetAsync("/configs/7");
        Assert.Equal(HttpStatusCode.OK, one.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/configs/8")).StatusCode);
    }

    [Fact]
    public async Task BlueprintEndpoints_UseWhateverIOutputBlueprintStoreIsRegistered()
    {
        using var factory = WithServices(services => services.Replace(ServiceDescriptor.Singleton<IOutputBlueprintStore>(new FakeOutputBlueprintStore())));
        using var client = factory.CreateClient();

        var list = await (await client.GetAsync("/blueprints")).Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal("fake blueprint", list[0].GetProperty("name").GetString());
    }

    [Fact]
    public async Task TransformPresetEndpoints_UseWhateverITransformPresetStoreIsRegistered()
    {
        using var factory = WithServices(services => services.Replace(ServiceDescriptor.Singleton<ITransformPresetStore>(new FakeTransformPresetStore())));
        using var client = factory.CreateClient();

        var list = await (await client.GetAsync("/transform-presets")).Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal("fake preset", list[0].GetProperty("name").GetString());
    }

    private sealed class FakeSavedConfigStore : ISavedConfigStore
    {
        public SavedConfigSummary Save(string url, string name, string configJson, long? blueprintId = null) => throw new NotSupportedException();
        public IReadOnlyList<SavedConfigSummary> ListByUrl(string url) => [new SavedConfigSummary(7, url, "from the fake store", "2026-01-01T00:00:00Z")];
        public IReadOnlyList<SavedConfigSummary> ListAll() => ListByUrl("https://example.com");
        public SavedConfigRecord? Get(long id) => id == 7 ? new SavedConfigRecord(7, "https://example.com", "from the fake store", "2026-01-01T00:00:00Z", "{}") : null;
        public bool Delete(long id) => false;
        public SavedOutputSummary SaveOutput(long savedConfigId, string name, string fileName, string content) => throw new NotSupportedException();
        public IReadOnlyList<SavedOutputSummary> ListOutputsByConfigId(long savedConfigId) => [];
        public SavedOutputRecord? GetOutput(long id) => null;
        public bool DeleteOutput(long id) => false;
        public SavedOutputSummary? GetMostRecentOutputForConfig(long savedConfigId, long excludeOutputId) => null;
        public SavedOutputSummary? GetMostRecentOutputForBlueprint(long blueprintId, long excludeOutputId) => null;
    }

    private sealed class FakeOutputBlueprintStore : IOutputBlueprintStore
    {
        public OutputBlueprintSummary Save(string name, string schemaKind, List<string>? fieldNames, List<OutputBlueprintTreeSchemaNode>? tree) => throw new NotSupportedException();
        public IReadOnlyList<OutputBlueprintSummary> ListAll() => [new OutputBlueprintSummary(1, "fake blueprint", "2026-01-01T00:00:00Z", 2, "Flat")];
        public OutputBlueprintRecord? Get(long id) => null;
        public bool Update(long id, string name, string schemaKind, List<string>? fieldNames, List<OutputBlueprintTreeSchemaNode>? tree) => false;
        public bool Delete(long id) => false;
    }

    private sealed class FakeTransformPresetStore : ITransformPresetStore
    {
        public TransformPresetSummary Save(string name, List<FieldTransform> transforms) => throw new NotSupportedException();
        public IReadOnlyList<TransformPresetSummary> ListAll() => [new TransformPresetSummary(1, "fake preset", "2026-01-01T00:00:00Z", [new TrimTransform()])];
        public bool Exists(long id) => false;
        public bool NameTaken(string name, long? exceptId = null) => false;
        public bool Rename(long id, string name) => false;
        public bool Delete(long id) => false;
    }
}
