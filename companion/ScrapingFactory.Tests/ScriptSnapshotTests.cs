using System.Net;
using System.Text;
using Microsoft.AspNetCore.Mvc.Testing;
using System.Text.Json.Nodes;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #386: golden-file tests for the generated Python scripts. Every refactoring of a template,
// a fragment or a code generator has to prove that the scripts did not change; this makes that
// mechanical. The requests go through the real POST /generate with SkipVerification, so the
// whole pipeline (validation, plan building, Combined/Blocks orchestration, rendering) is covered
// and nothing is executed: no Python, no network. See SnapshotCases for the matrix and
// SnapshotSupport for how to update a snapshot.
public class ScriptSnapshotTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    public static IEnumerable<object[]> CaseIds() => SnapshotCases.All.Select(c => new object[] { c.Id });

    private async Task<string> RenderAsync(string id)
    {
        var json = SnapshotCases.All.Single(c => c.Id == id).Json;
        var request = JsonNode.Parse(json)!.AsObject();
        request["skipVerification"] = true; // render only: nothing is run against a page
        var response = await _client.PostAsync("/generate", new StringContent(request.ToJsonString(), Encoding.UTF8, "application/json"));
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, $"snapshot case '{id}' was rejected ({(int)response.StatusCode}): {body}");
        return SnapshotSupport.Normalize(body);
    }

    [Theory]
    [MemberData(nameof(CaseIds))]
    public async Task Snapshot_MatchesTheCommittedScript(string id)
    {
        var actual = await RenderAsync(id);

        if (SnapshotSupport.UpdateRequested)
        {
            SnapshotSupport.Write(id, actual);
            return;
        }

        var path = SnapshotSupport.PathFor(id);
        Assert.True(File.Exists(path),
            $"Snapshots/{id}.py does not exist yet. Create it with{Environment.NewLine}  {SnapshotSupport.UpdateCommand}{Environment.NewLine}and review the new file.");
        var expected = SnapshotSupport.Normalize(await File.ReadAllTextAsync(path));
        if (expected != actual) Assert.Fail(SnapshotSupport.Describe(id, expected, actual));
    }

    [Fact]
    public void Snapshots_HaveNoOrphanFiles()
    {
        var known = SnapshotCases.All.Select(c => c.Id).ToHashSet();
        var orphans = Directory.Exists(SnapshotSupport.SnapshotsDirectory)
            ? Directory.GetFiles(SnapshotSupport.SnapshotsDirectory, "*.py")
                .Where(f => !known.Contains(Path.GetFileNameWithoutExtension(f))).ToList()
            : [];
        if (SnapshotSupport.UpdateRequested)
        {
            foreach (var orphan in orphans) File.Delete(orphan);
            return;
        }
        Assert.True(orphans.Count == 0,
            $"Snapshot files without a case: {string.Join(", ", orphans.Select(Path.GetFileName))}. Remove the files, or run{Environment.NewLine}  {SnapshotSupport.UpdateCommand}{Environment.NewLine}to delete them.");
    }

    [Fact]
    public async Task Snapshots_AreDeterministic()
    {
        foreach (var (id, _) in SnapshotCases.All)
        {
            var first = await RenderAsync(id);
            var second = await RenderAsync(id);
            Assert.True(first == second, $"snapshot case '{id}' renders differently on a second run — something non-deterministic (a time, a random value, an ordering) reaches the script");
        }
    }
}
