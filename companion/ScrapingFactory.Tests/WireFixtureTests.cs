using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc.Testing;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #388: wire-format contract, companion half. test-vectors/wire/*.json are the request bodies the extension's
// real builders produce for a matrix of popup states (extension/popup/wire-fixtures.test.js writes and verifies them).
// Each one must (1) deserialize STRICTLY into the real ScrapingConfig — a property the IR does not know fails, so the
// extension cannot send something the companion silently ignores — and (2) be accepted by /generate end to end
// (validation, plan building and rendering; skipVerification, so nothing is run). The reverse drift, a companion
// change the extension does not follow, shows up as a rejected request here or as a changed fixture there.
public class WireFixtureTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    private static readonly JsonSerializerOptions StrictOptions = BuildStrictOptions();

    private static JsonSerializerOptions BuildStrictOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
        options.Converters.Add(new JsonStringEnumConverter());
        options.Converters.Add(new ContainerNodeJsonConverter());
        options.Converters.Add(new ApiNodeJsonConverter());
        options.Converters.Add(new ApiBodyNodeJsonConverter());
        options.Converters.Add(new OutputBlueprintTreeSchemaNodeJsonConverter());
        options.Converters.Add(new OutputBlueprintTreeMappingNodeJsonConverter());
        return options;
    }

    private static string FixtureDirectory => Path.Combine(Path.GetDirectoryName(TestVectors.PathOf("load.js"))!, "wire");

    public static IEnumerable<object[]> Fixtures() =>
        Directory.GetFiles(FixtureDirectory, "*.json").Order().Select(f => new object[] { Path.GetFileNameWithoutExtension(f) });

    [Fact]
    public void TheMatrixIsNotEmpty() => Assert.True(Directory.GetFiles(FixtureDirectory, "*.json").Length >= 30);

    [Theory]
    [MemberData(nameof(Fixtures))]
    public void Fixture_DeserializesStrictlyIntoScrapingConfig(string id)
    {
        var json = File.ReadAllText(Path.Combine(FixtureDirectory, id + ".json"));
        var config = JsonSerializer.Deserialize<ScrapingConfig>(json, StrictOptions);
        Assert.NotNull(config);
    }

    [Theory]
    [MemberData(nameof(Fixtures))]
    public async Task Fixture_IsAcceptedByGenerate(string id)
    {
        var request = JsonNode.Parse(File.ReadAllText(Path.Combine(FixtureDirectory, id + ".json")))!.AsObject();
        request["skipVerification"] = true; // render only: nothing is run against a page
        var response = await _client.PostAsync("/generate", new StringContent(request.ToJsonString(), Encoding.UTF8, "application/json"));
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, $"wire fixture '{id}' was rejected ({(int)response.StatusCode}): {body}");
    }
}
