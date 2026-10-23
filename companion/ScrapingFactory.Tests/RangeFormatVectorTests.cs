using System.Text.Json;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #388: RangeFormat (C#) and the generated API script's range helpers against the shared vectors
// test-vectors/range-format.json and range-expansion.json. The extension's compileRangeFormatPattern runs the
// first file in popup/range-format-vectors.test.js.
public class RangeFormatVectorTests
{
    private const string MatchFile = "range-format.json";
    private const string ExpansionFile = "range-expansion.json";

    private static RangeType TypeOf(JsonElement testCase) => Enum.Parse<RangeType>(testCase.GetProperty("type").GetString()!);

    public static IEnumerable<object[]> MatchCases() => TestVectors.Names(MatchFile);
    public static IEnumerable<object[]> ExpansionCases() => TestVectors.Names(ExpansionFile);

    [Theory]
    [MemberData(nameof(MatchCases))]
    public void IsValid_MatchesTheSharedVectors(string name)
    {
        var testCase = TestVectors.Case(MatchFile, name);
        Assert.Equal(testCase.GetProperty("matches").GetBoolean(),
            RangeFormat.IsValid(testCase.GetProperty("value").GetString()!, testCase.GetProperty("format").GetString()!, allowToday: false));
    }

    [Theory]
    [MemberData(nameof(ExpansionCases))]
    public void CountValues_EqualsTheNumberOfValuesInTheVectors(string name)
    {
        var testCase = TestVectors.Case(ExpansionFile, name);
        var source = new RangeSource
        {
            Type = TypeOf(testCase),
            From = testCase.GetProperty("from").GetString()!,
            To = testCase.GetProperty("to").GetString()!,
            Format = testCase.StringOrNull("format"),
        };
        Assert.Equal(testCase.GetProperty("values").GetArrayLength(), RangeFormat.CountValues(source));
    }

    private static string ApiScript() => new PythonApiCodeGenerator().Generate(new ScrapingPlan
    {
        Steps =
        [
            new NavigateStep { Urls = ["https://example.com"] },
            new ApiCallStep
            {
                Config = new ApiConfig
                {
                    UrlTemplate = "https://example.com/api/{n}",
                    ItemsPath = "items",
                    Fields = [new ApiField { Name = "A", Path = "a" }],
                    Parameters = [new ApiParameter { Name = "n", Source = new RangeSource { Type = RangeType.Number, From = "1", To = "2" } }],
                },
            },
        ],
        OutputFormat = OutputFormat.Csv,
        Engine = ScrapingEngine.Api,
    });

    [Fact]
    public async Task Script_CompileRangeFormat_MatchesTheSharedVectors()
    {
        var cases = TestVectors.Cases(MatchFile);
        var input = cases.Select(c => new { format = c.GetProperty("format").GetString(), value = c.GetProperty("value").GetString() }).ToList();

        var output = await PythonContractHarness.RunAsync(ApiScript(),
            "result = [mod._compile_range_format(item['format']).match(item['value']) is not None for item in data]", input);

        var mismatches = cases.Select((c, i) => (Name: c.GetProperty("name").GetString(), Expected: c.GetProperty("matches").GetBoolean(), Actual: output[i].GetBoolean()))
            .Where(x => x.Expected != x.Actual).Select(x => $"{x.Name}: expected {x.Expected}").ToList();
        Assert.True(mismatches.Count == 0, "The generated script disagrees with the vectors:" + Environment.NewLine + string.Join(Environment.NewLine, mismatches));
    }

    [Fact]
    public async Task Script_RangeHelpers_ProduceTheValuesInTheSharedVectors()
    {
        var cases = TestVectors.Cases(ExpansionFile);
        var input = cases.Select(c => new
        {
            type = c.GetProperty("type").GetString(),
            from = c.GetProperty("from").GetString(),
            to = c.GetProperty("to").GetString(),
            format = c.StringOrNull("format"),
        }).ToList();

        var output = await PythonContractHarness.RunAsync(ApiScript(), """
            result = []
            for item in data:
                if item["type"] == "Number":
                    result.append(mod._number_range(item["from"], item["to"]))
                elif item["type"] == "IsoWeek":
                    result.append(mod._iso_week_range(item["from"], item["to"], item["format"] or "{yyyy}-W{ww}"))
                else:
                    result.append(mod._date_range(item["from"], item["to"], item["format"] or "{yyyy}-{mm}-{dd}"))
            """, input);

        var mismatches = new List<string>();
        for (var i = 0; i < cases.Count; i++)
        {
            var expected = cases[i].GetProperty("values").EnumerateArray().Select(v => v.GetString()).ToList();
            var actual = output[i].EnumerateArray().Select(v => v.GetString()).ToList();
            if (!expected.SequenceEqual(actual))
                mismatches.Add($"{cases[i].GetProperty("name").GetString()}: expected [{string.Join(", ", expected)}], script gave [{string.Join(", ", actual)}]");
        }
        Assert.True(mismatches.Count == 0, string.Join(Environment.NewLine, mismatches));
    }
}
