using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #207: pure unit coverage for HardeningReplayEvaluator — every check
// kind against every saved-output shape (CSV/JSON flat, XML tree), plus the
// Inconclusive/NotEvaluable outcomes that don't have a live-runtime
// equivalent at all. Doesn't run a real script (unlike the Hardening*EndToEndTests
// classes) — this evaluator is pure C# over an already-materialized string,
// so a direct unit test is both sufficient and much faster.
public class HardeningReplayEvaluatorTests
{
    private const string Csv = "Titel,Preis\nA,10\nB,\nC,30\n";
    private const string Json = """[{"Titel":"A","Preis":"10"},{"Titel":"B","Preis":""},{"Titel":"C","Preis":"30"}]""";
    private const string Xml = "<Ergebnis><Item><Titel>A</Titel><Preis>10</Preis></Item><Item><Titel>B</Titel><Preis></Preis></Item><Item><Titel>C</Titel><Preis>30</Preis></Item></Ergebnis>";

    private static HardeningReplayCheckResult EvaluateSingle(HardeningCheck check, string fileName, string content, int? previousCount = null, string? previousReason = null) =>
        HardeningReplayEvaluator.Evaluate([check], fileName, content, previousCount, previousReason).Single();

    [Theory]
    [InlineData("output.csv", Csv)]
    [InlineData("output.json", Json)]
    [InlineData("output.xml", Xml)]
    public void NoResult_NonEmptyDataset_Passes(string fileName, string content)
    {
        var result = EvaluateSingle(new NoResultCheck { Severity = HardeningSeverity.Error }, fileName, content);
        Assert.Equal(HardeningReplayOutcome.Passed, result.Outcome);
    }

    [Theory]
    [InlineData("output.csv", "Titel,Preis\n")]
    [InlineData("output.json", "[]")]
    [InlineData("output.xml", "<Ergebnis></Ergebnis>")]
    public void NoResult_EmptyDataset_Triggers(string fileName, string content)
    {
        var result = EvaluateSingle(new NoResultCheck { Severity = HardeningSeverity.Error }, fileName, content);
        Assert.Equal(HardeningReplayOutcome.Triggered, result.Outcome);
    }

    [Theory]
    [InlineData("output.csv", Csv)]
    [InlineData("output.json", Json)]
    [InlineData("output.xml", Xml)]
    public void NullRate_OneOfThreeEmpty_TriggersAtLowThreshold(string fileName, string content)
    {
        var check = new NullRateCheck { Severity = HardeningSeverity.Warning, FieldName = "Preis", Threshold = 0.1 };
        var result = EvaluateSingle(check, fileName, content);
        Assert.Equal(HardeningReplayOutcome.Triggered, result.Outcome);
    }

    [Theory]
    [InlineData("output.csv", Csv)]
    [InlineData("output.json", Json)]
    [InlineData("output.xml", Xml)]
    public void NullRate_OneOfThreeEmpty_PassesAtHighThreshold(string fileName, string content)
    {
        var check = new NullRateCheck { Severity = HardeningSeverity.Warning, FieldName = "Preis", Threshold = 0.9 };
        var result = EvaluateSingle(check, fileName, content);
        Assert.Equal(HardeningReplayOutcome.Passed, result.Outcome);
    }

    [Theory]
    [InlineData("output.csv", Csv)]
    [InlineData("output.json", Json)]
    [InlineData("output.xml", Xml)]
    public void NullRate_UnknownField_IsInconclusive(string fileName, string content)
    {
        var check = new NullRateCheck { Severity = HardeningSeverity.Warning, FieldName = "DoesNotExist", Threshold = 0.1 };
        var result = EvaluateSingle(check, fileName, content);
        Assert.Equal(HardeningReplayOutcome.Inconclusive, result.Outcome);
    }

    [Theory]
    [InlineData("output.csv", Csv)]
    [InlineData("output.json", Json)]
    [InlineData("output.xml", Xml)]
    public void RequiredFields_OneOfThreeMissingPreis_Triggers(string fileName, string content)
    {
        var check = new RequiredFieldsCheck { Severity = HardeningSeverity.Error, FieldNames = ["Preis"] };
        var result = EvaluateSingle(check, fileName, content);
        Assert.Equal(HardeningReplayOutcome.Triggered, result.Outcome);
        Assert.Contains("1", result.Message);
    }

    [Theory]
    [InlineData("output.csv", Csv)]
    [InlineData("output.json", Json)]
    [InlineData("output.xml", Xml)]
    public void RequiredFields_AllPresent_Passes(string fileName, string content)
    {
        var check = new RequiredFieldsCheck { Severity = HardeningSeverity.Error, FieldNames = ["Titel"] };
        var result = EvaluateSingle(check, fileName, content);
        Assert.Equal(HardeningReplayOutcome.Passed, result.Outcome);
    }

    [Fact]
    public void RequiredFields_TreeMode_ZeroMatchesInInstance_IsNotAFailure()
    {
        // Mirrors _passes_required_fields' own semantic exactly: a field
        // with NO matches at all inside one instance is a silent no-op
        // there (not a failure) — only a match that's present but empty
        // fails that instance. "B" here has no <Beschreibung> element at
        // all (not an empty one), so it must not count as missing.
        const string xml = "<Ergebnis><Item><Titel>A</Titel></Item><Item><Titel>B</Titel></Item></Ergebnis>";
        var check = new RequiredFieldsCheck { Severity = HardeningSeverity.Error, FieldNames = ["Titel"] };
        var result = EvaluateSingle(check, "output.xml", xml);
        Assert.Equal(HardeningReplayOutcome.Passed, result.Outcome);
    }

    [Fact]
    public void RequiredFields_TreeMode_PresentButEmptyMatch_CountsAsMissing()
    {
        const string xml = "<Ergebnis><Item><Titel>A</Titel></Item><Item><Titel></Titel></Item></Ergebnis>";
        var check = new RequiredFieldsCheck { Severity = HardeningSeverity.Error, FieldNames = ["Titel"] };
        var result = EvaluateSingle(check, "output.xml", xml);
        Assert.Equal(HardeningReplayOutcome.Triggered, result.Outcome);
        Assert.Contains("1", result.Message);
    }

    [Fact]
    public void Baseline_DropBeyondThreshold_Triggers()
    {
        var check = new BaselineCheck { Severity = HardeningSeverity.Error, DropThreshold = 0.1 };
        // Csv has 3 rows; previous was 10 -> a 70% drop, beyond the 10% threshold.
        var result = EvaluateSingle(check, "output.csv", Csv, previousCount: 10);
        Assert.Equal(HardeningReplayOutcome.Triggered, result.Outcome);
    }

    [Fact]
    public void Baseline_DropWithinThreshold_Passes()
    {
        var check = new BaselineCheck { Severity = HardeningSeverity.Error, DropThreshold = 0.9 };
        var result = EvaluateSingle(check, "output.csv", Csv, previousCount: 4);
        Assert.Equal(HardeningReplayOutcome.Passed, result.Outcome);
    }

    [Fact]
    public void Baseline_NoPreviousCount_IsInconclusiveWithGivenReason()
    {
        var check = new BaselineCheck { Severity = HardeningSeverity.Error, DropThreshold = 0.1 };
        var result = EvaluateSingle(check, "output.csv", Csv, previousCount: null, previousReason: "No earlier saved output exists for this configuration.");
        Assert.Equal(HardeningReplayOutcome.Inconclusive, result.Outcome);
        Assert.Equal("No earlier saved output exists for this configuration.", result.Message);
    }

    [Fact]
    public void Blocking_IsAlwaysNotEvaluable()
    {
        var check = new BlockingCheck { Severity = HardeningSeverity.Warning };
        var result = EvaluateSingle(check, "output.csv", Csv);
        Assert.Equal(HardeningReplayOutcome.NotEvaluable, result.Outcome);
    }

    [Fact]
    public void Evaluate_MultipleChecks_ReturnsOneResultPerCheckInOrder()
    {
        var checks = new HardeningCheck[]
        {
            new NoResultCheck { Severity = HardeningSeverity.Error },
            new BlockingCheck { Severity = HardeningSeverity.Warning },
        };
        var results = HardeningReplayEvaluator.Evaluate(checks, "output.csv", Csv, null, null);
        Assert.Equal(2, results.Count);
        Assert.Equal("noResult", results[0].Kind);
        Assert.Equal("blocking", results[1].Kind);
    }

    [Fact]
    public void GetResultCount_Csv_ReturnsRowCount()
    {
        Assert.Equal(3, HardeningReplayEvaluator.GetResultCount("output.csv", Csv));
    }

    [Fact]
    public void GetResultCount_Xml_ReturnsDescendantElementCount()
    {
        // 3 <Item> + 3 <Titel> + 3 <Preis> = 9 descendant elements, matching
        // the runtime's own len(root.findall(".//*")).
        Assert.Equal(9, HardeningReplayEvaluator.GetResultCount("output.xml", Xml));
    }
}
