using System.Text.Json;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #388: the generated scripts' run-time robots.txt matching (_parse_robots_rules/_robots_allowed in
// fragments/robots_disallow.py.j2) against test-vectors/robots.json — the table the extension's advisory check
// (content/robots-vectors.test.js) also runs. The rules for one origin are injected into the module's cache so
// nothing touches the network.
public class RobotsVectorTests
{
    private const string VectorFile = "robots.json";
    private const string Origin = "https://example.test";

    private static readonly Lazy<Task<Dictionary<string, bool>>> Results = new(RunAllAsync);

    private static bool AppliesToPython(JsonElement testCase) =>
        !testCase.TryGetProperty("appliesTo", out var applies) || applies.EnumerateArray().Any(a => a.GetString() == "python");

    private static async Task<Dictionary<string, bool>> RunAllAsync()
    {
        var cases = TestVectors.Cases(VectorFile).Where(AppliesToPython).ToList();
        var script = new PythonCodeGenerator().Generate(new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [Origin + "/"] }, new ExtractStep { Name = "F", Selector = ".v" }],
            RobotsDisallow = new RobotsDisallowConfig(),
        });

        var input = cases.Select(c => new { robots = c.GetProperty("robots").GetString(), path = c.GetProperty("path").GetString() }).ToList();
        var output = await PythonContractHarness.RunAsync(script, $$"""
            result = []
            for item in data:
                mod._robots_rules["{{Origin}}"] = mod._parse_robots_rules(item["robots"])
                result.append(mod._robots_allowed("{{Origin}}" + item["path"]))
            """, input);

        return cases.Select((c, i) => (Name: c.GetProperty("name").GetString()!, Allowed: output[i].GetBoolean()))
            .ToDictionary(x => x.Name, x => x.Allowed);
    }

    public static IEnumerable<object[]> Cases() =>
        TestVectors.Cases(VectorFile).Where(AppliesToPython).Select(c => new object[] { c.GetProperty("name").GetString()! });

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task RobotsAllowed_MatchesTheSharedVectors(string name)
    {
        var expected = TestVectors.Case(VectorFile, name).GetProperty("allowed").GetBoolean();
        Assert.Equal(expected, (await Results.Value)[name]);
    }
}
