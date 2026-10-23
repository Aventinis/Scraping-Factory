using System.Text.Json.Nodes;

namespace ScrapingFactory.Tests;

// Issue #386: the matrix of requests whose generated Python script is pinned by a snapshot
// (Snapshots/<id>.py). A case is a wire-format JSON request (what the extension sends), written
// as a base shape plus the features that change the script — so a reader sees at a glance what
// each snapshot is about. Features that interact are combined on purpose (see "Interactions").
//
// Add a case when a new setting reaches a template: SnapshotCoverageTests lists every IR
// property that no case uses. Then run `UPDATE_SNAPSHOTS=1 dotnet test --filter Snapshot` and
// read the new file in the diff.
public static partial class SnapshotCases
{
    // ---- Base shapes -------------------------------------------------------------------------
    private const string Flat = """
        {"url":"https://example.test/list","fields":[
          {"name":"Title","selector":"h2.title"},
          {"name":"Price","selector":"span.price"},
          {"name":"Link","selector":"a.more","attribute":"href"}]}
        """;

    private const string Container = """
        {"url":"https://example.test/menu","groups":[
          {"name":"Category","selector":"section.category","repeating":true,"children":[
            {"name":"Heading","selector":"h2","mode":"Text"},
            {"name":"Dish","selector":"li.dish","repeating":true,"children":[
              {"name":"Name","selector":"h3","mode":"Text"},
              {"name":"Price","selector":".price","mode":"Text"}]}]}]}
        """;

    private const string ApiFlat = """
        {"url":"https://example.test/","api":{"method":"GET",
          "urlTemplate":"https://example.test/api/items?week={week}",
          "parameters":[{"name":"week","source":{"kind":"staticList","values":["1","2","3"]}}],
          "itemsPath":"items",
          "fields":[{"name":"Name","path":"name"},{"name":"Price","path":"price"}]}}
        """;

    private const string ApiTree = """
        {"url":"https://example.test/","api":{"method":"GET",
          "urlTemplate":"https://example.test/api/categories",
          "groups":[{"name":"Category","path":"categories","children":[
            {"name":"Name","path":"name"},
            {"name":"Product","path":"products","children":[
              {"name":"Title","path":"title"},{"name":"Price","path":"price"}]}]}]}}
        """;

    private const string LoginActions = """
        [{"kind":"waitFor","selector":"form#login","timeoutMs":15000},
         {"kind":"fill","selector":"#user","environmentVariableName":"SITE_USERNAME"},
         {"kind":"fill","selector":"#password","environmentVariableName":"SITE_PASSWORD"},
         {"kind":"click","selector":"button.login"},
         {"kind":"waitFor","selector":".account","timeoutMs":10000}]
        """;

    private static readonly List<(string Id, string Json)> Cases = [];

    /// <summary>Every case, in registration order.</summary>
    public static IReadOnlyList<(string Id, string Json)> All
    {
        get { EnsureBuilt(); return Cases; }
    }

    private static bool _built;
    private static readonly object Gate = new();

    private static void EnsureBuilt()
    {
        lock (Gate)
        {
            if (_built) return;
            RegisterShapes();
            RegisterOutputFormats();
            RegisterStaticFlat();
            RegisterBrowserFlat();
            RegisterContainer();
            RegisterApi();
            RegisterBlocksAndCombined();
            RegisterInteractions();
            var duplicate = Cases.GroupBy(c => c.Id).FirstOrDefault(g => g.Count() > 1);
            if (duplicate is not null) throw new InvalidOperationException($"duplicate snapshot case id '{duplicate.Key}'");
            _built = true;
        }
    }

    /// <summary>Registers a case: the base shape with the given top-level properties set on top of it.</summary>
    private static void Add(string id, string baseJson, string? patchJson = null)
    {
        var node = JsonNode.Parse(baseJson)!.AsObject();
        if (patchJson is not null)
        {
            foreach (var (name, value) in JsonNode.Parse(patchJson)!.AsObject())
                node[name] = value?.DeepClone();
        }
        Cases.Add((id, node.ToJsonString()));
    }

    /// <summary>Same as <see cref="Add"/> for a base shape that already carries the Browser engine.</summary>
    private static string WithBrowser(string baseJson)
    {
        var node = JsonNode.Parse(baseJson)!.AsObject();
        node["engine"] = "Browser";
        return node.ToJsonString();
    }

    // ---- The shapes themselves, one per engine ------------------------------------------------
    private static void RegisterShapes()
    {
        Add("static-flat", Flat);
        Add("browser-flat", WithBrowser(Flat));
        Add("static-container", Container);
        Add("browser-container", WithBrowser(Container));
        Add("api-flat", ApiFlat);
        Add("api-tree", ApiTree);
    }
}
