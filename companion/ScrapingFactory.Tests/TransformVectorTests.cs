using System.Text.Json;
using System.Text.Json.Serialization;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #388: the generated scripts' _apply_transforms against test-vectors/transforms.json, the table
// the extension's live preview (applyTransformsPreview, popup/transform-vectors.test.js) also runs. Each
// case becomes one field of a real flat script; the helper is then called on the module's own TRANSFORMS.
public class TransformVectorTests
{
    private const string VectorFile = "transforms.json";

    private static readonly JsonSerializerOptions WireOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() },
    };

    private static readonly Lazy<Task<Dictionary<string, string>>> Results = new(RunAllAsync);

    private static bool AppliesToPython(JsonElement testCase) =>
        !testCase.TryGetProperty("appliesTo", out var applies) || applies.EnumerateArray().Any(a => a.GetString() == "python");

    private static async Task<Dictionary<string, string>> RunAllAsync()
    {
        var cases = TestVectors.Cases(VectorFile).Where(AppliesToPython).ToList();
        var steps = new List<ScrapingStep> { new NavigateStep { Urls = ["https://example.com/"] } };
        for (var i = 0; i < cases.Count; i++)
        {
            var transforms = cases[i].GetProperty("transforms").Deserialize<List<FieldTransform>>(WireOptions)!;
            steps.Add(new ExtractStep { Name = $"F{i}", Selector = ".v", Transforms = transforms });
        }
        var script = new PythonCodeGenerator().Generate(new ScrapingPlan { Steps = steps });

        var input = cases.Select((c, i) => new { name = $"F{i}", value = c.GetProperty("value").GetString() }).ToList();
        var output = await PythonContractHarness.RunAsync(script,
            "result = [mod._apply_transforms(item['value'], mod.TRANSFORMS[item['name']]) for item in data]", input);

        return cases.Select((c, i) => (Name: c.GetProperty("name").GetString()!, Value: output[i].GetString()!))
            .ToDictionary(x => x.Name, x => x.Value);
    }

    public static IEnumerable<object[]> Cases() =>
        TestVectors.Cases(VectorFile).Where(AppliesToPython).Select(c => new object[] { c.GetProperty("name").GetString()! });

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task ApplyTransforms_MatchesTheSharedVectors(string name)
    {
        var expected = TestVectors.Case(VectorFile, name).GetProperty("expected").GetString();
        Assert.Equal(expected, (await Results.Value)[name]);
    }
}
