using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #386: guards around the snapshot matrix itself. The snapshots only protect what the cases
// actually exercise, so these tests keep the matrix honest: no case may carry a property the IR
// does not know (a typo would silently render the default script), every IR option that can reach
// a template has to appear in at least one case, and no snapshot may contain anything that
// depends on the machine it was generated on.
public class SnapshotCoverageTests
{
    // IR properties that are deliberately not part of the snapshot matrix, each with the reason.
    // Everything else on the wire format has to show up in at least one case.
    private static readonly Dictionary<string, string> NotRendered = new()
    {
        ["verificationValues"] = "only used for the trial run, never rendered into a script",
        ["skipVerification"] = "controls /generate itself; the snapshot requests always set it",
        ["includePreview"] = "shapes the /generate response, not the script",
        ["includeOutputFile"] = "shapes the /generate response, not the script",
        ["savedConfigId"] = "round-trip metadata of a Combined component, never read during generation",
        ["version"] = "wire-format version marker, never rendered",
    };

    private static readonly JsonSerializerOptions StrictOptions = BuildStrictOptions();

    private static JsonSerializerOptions BuildStrictOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        };
        options.Converters.Add(new JsonStringEnumConverter());
        options.Converters.Add(new ContainerNodeJsonConverter());
        options.Converters.Add(new ApiNodeJsonConverter());
        options.Converters.Add(new ApiBodyNodeJsonConverter());
        options.Converters.Add(new OutputBlueprintTreeSchemaNodeJsonConverter());
        options.Converters.Add(new OutputBlueprintTreeMappingNodeJsonConverter());
        return options;
    }

    [Fact]
    public void Cases_UseOnlyPropertiesTheIrKnows()
    {
        var problems = new List<string>();
        foreach (var testCase in SnapshotCases.All)
        {
            try
            {
                JsonSerializer.Deserialize<ScrapingConfig>(testCase.Json, StrictOptions);
            }
            catch (JsonException ex)
            {
                problems.Add($"{testCase.Id}: {ex.Message}");
            }
        }
        Assert.True(problems.Count == 0, "Snapshot cases with an unknown property (a typo renders the default script):" + Environment.NewLine + string.Join(Environment.NewLine, problems));
    }

    [Fact]
    public void EveryIrPropertyAppearsInAtLeastOneCase()
    {
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var testCase in SnapshotCases.All) CollectPropertyNames(JsonNode.Parse(testCase.Json), used);

        var uncovered = ReachableIrTypes()
            .SelectMany(t => t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            .Where(p => p.GetCustomAttribute<JsonIgnoreAttribute>() is null && p.SetMethod is { IsPublic: true }) // computed read-only members are not input
            .Select(p => JsonNamingPolicy.CamelCase.ConvertName(p.Name))
            .Distinct()
            .Where(name => !used.Contains(name) && !NotRendered.ContainsKey(name))
            .Order()
            .ToList();

        Assert.True(uncovered.Count == 0,
            "IR properties no snapshot case uses. Add a case in SnapshotCases*.cs that sets them, or list the property in SnapshotCoverageTests.NotRendered with the reason it never reaches a script:"
            + Environment.NewLine + string.Join(Environment.NewLine, uncovered.Select(n => "  " + n)));
    }

    [Fact]
    public void NotRenderedEntries_AreStillRealIrProperties()
    {
        var known = ReachableIrTypes()
            .SelectMany(t => t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            .Select(p => JsonNamingPolicy.CamelCase.ConvertName(p.Name))
            .ToHashSet();
        var stale = NotRendered.Keys.Where(k => !known.Contains(k)).ToList();
        Assert.True(stale.Count == 0, "NotRendered lists properties that no longer exist: " + string.Join(", ", stale));
    }

    [Fact]
    public void Snapshots_ContainNothingMachineSpecific()
    {
        var markers = new[] { "/home/", "/Users/", "/tmp/", "C:\\Users", Environment.UserName, Environment.MachineName };
        var leaks = new List<string>();
        foreach (var file in Directory.GetFiles(SnapshotSupport.SnapshotsDirectory, "*.py"))
        {
            var text = File.ReadAllText(file);
            foreach (var marker in markers.Where(m => !string.IsNullOrEmpty(m) && text.Contains(m, StringComparison.Ordinal)))
                leaks.Add($"{Path.GetFileName(file)} contains '{marker}'");
        }
        Assert.True(leaks.Count == 0, "Snapshots must not depend on the machine they were generated on:" + Environment.NewLine + string.Join(Environment.NewLine, leaks));
    }

    private static void CollectPropertyNames(JsonNode? node, HashSet<string> names)
    {
        switch (node)
        {
            case JsonObject obj:
                foreach (var (key, value) in obj)
                {
                    names.Add(key);
                    CollectPropertyNames(value, names);
                }
                break;
            case JsonArray array:
                foreach (var item in array) CollectPropertyNames(item, names);
                break;
        }
    }

    // Every concrete public type in the IR namespace that is part of the request wire format.
    // Persisted-store records (saved configs, blueprints definitions, ...) are not part of it.
    private static IEnumerable<Type> ReachableIrTypes()
    {
        var seen = new HashSet<Type>();
        var queue = new Queue<Type>();
        queue.Enqueue(typeof(ScrapingConfig));
        while (queue.Count > 0)
        {
            var type = queue.Dequeue();
            if (!seen.Add(type)) continue;
            yield return type;

            foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
                foreach (var next in Referenced(property.PropertyType)) queue.Enqueue(next);

            // Polymorphic bases: follow the derived types too.
            foreach (var derived in type.GetCustomAttributes<JsonDerivedTypeAttribute>()) queue.Enqueue(derived.DerivedType);
            if (type.IsAbstract && type.Namespace == typeof(ScrapingConfig).Namespace)
                foreach (var derived in type.Assembly.GetTypes().Where(t => t.IsSubclassOf(type))) queue.Enqueue(derived);
        }
    }

    private static IEnumerable<Type> Referenced(Type type)
    {
        if (type.IsGenericType)
        {
            foreach (var argument in type.GetGenericArguments())
                foreach (var next in Referenced(argument)) yield return next;
            yield break;
        }
        if (type.IsArray) { foreach (var next in Referenced(type.GetElementType()!)) yield return next; yield break; }
        if (type.Namespace == typeof(ScrapingConfig).Namespace && !type.IsEnum) yield return type;
    }
}
