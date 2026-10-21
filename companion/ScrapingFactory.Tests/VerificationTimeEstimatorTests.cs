using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Tests;

// Issue #295: the trial-run timeout estimate has to see API mode's own
// parameter combination count, not only browser-action durations.
public class VerificationTimeEstimatorTests
{
    private static ScrapingPlan ApiPlan(params ApiParameter[] parameters) => new()
    {
        Engine = ScrapingEngine.Api,
        Steps =
        [
            new NavigateStep { Urls = ["https://example.com"] },
            new ApiCallStep
            {
                Config = new ApiConfig
                {
                    UrlTemplate = "https://example.com/api?x={x}",
                    ItemsPath = "items",
                    Fields = [new ApiField { Name = "n", Path = "n" }],
                    Parameters = [.. parameters],
                },
            },
        ],
    };

    private static ApiParameter List(string name, int count) => new()
    {
        Name = name,
        Source = new StaticListSource { Values = Enumerable.Range(0, count).Select(i => $"v{i}").ToList() },
    };

    private static ApiParameter Range(string name, RangeType type, string from, string to, string? format = null) => new()
    {
        Name = name,
        Source = new RangeSource { Type = type, From = from, To = to, Format = format },
    };

    [Fact]
    public void EstimateExtraMs_IssueScenario_11WeeksTimes22Categories_Covers241ExtraRequests()
    {
        var plan = ApiPlan(
            Range("KW", RangeType.IsoWeek, "2026-40", "2026-50", "{yyyy}-{ww}"),
            List("Gruppe", 22));

        Assert.Equal(242, VerificationTimeEstimator.CountApiCombinations(((ApiCallStep)plan.Steps[1]).Config));
        Assert.Equal(241 * VerificationTimeEstimator.AssumedMsPerApiRequest, VerificationTimeEstimator.EstimateExtraMs(plan));
    }

    [Fact]
    public void EstimateExtraMs_SingleCombination_AddsNothing()
    {
        Assert.Equal(0, VerificationTimeEstimator.EstimateExtraMs(ApiPlan(List("x", 1))));
    }

    [Fact]
    public void EstimateExtraMs_NoApiStepAndNoActions_IsZero()
    {
        var plan = new ScrapingPlan { Steps = [new NavigateStep { Urls = ["https://example.com"] }] };
        Assert.Equal(0, VerificationTimeEstimator.EstimateExtraMs(plan));
    }

    [Fact]
    public void EstimateExtraMs_ZeroValueParameter_MakesTheProductZeroAndAddsNothing()
    {
        Assert.Equal(0, VerificationTimeEstimator.EstimateExtraMs(ApiPlan(List("a", 0), List("b", 500))));
    }

    [Fact]
    public void EstimateExtraMs_RuntimeResolvedParameter_DoesNotMultiply()
    {
        var discovery = new ApiParameter
        {
            Name = "d",
            Source = new DiscoverySource { UrlTemplate = "https://example.com/d", ItemsPath = "i", ValuePath = "v" },
        };
        Assert.Equal(9 * VerificationTimeEstimator.AssumedMsPerApiRequest, VerificationTimeEstimator.EstimateExtraMs(ApiPlan(discovery, List("x", 10))));
    }

    [Fact]
    public void EstimateExtraMs_AddsToBrowserActionDurations()
    {
        var plan = ApiPlan(List("x", 3));
        plan.Steps.Add(new ScrollStep { MaxIterations = 2, WaitAfterMs = 500 });

        Assert.Equal(1000 + 2 * VerificationTimeEstimator.AssumedMsPerApiRequest, VerificationTimeEstimator.EstimateExtraMs(plan));
    }

    [Fact]
    public void EstimateExtraMs_HugeProduct_SaturatesInsteadOfOverflowing()
    {
        var plan = ApiPlan(
            Range("a", RangeType.Number, "1", "4000000000"),
            Range("b", RangeType.Number, "1", "4000000000"),
            Range("c", RangeType.Number, "1", "4000000000"));

        Assert.Equal(long.MaxValue, VerificationTimeEstimator.EstimateExtraMs(plan));
    }

    [Theory]
    [InlineData(RangeType.Number, "5", "9", null, 5)]
    [InlineData(RangeType.Number, "9", "5", null, 0)]
    [InlineData(RangeType.IsoWeek, "2026-W40", "2026-W40", null, 1)]
    [InlineData(RangeType.IsoWeek, "2026-W40", "2026-W50", null, 11)]
    // Crosses the year boundary: 2026 has 53 ISO weeks, so W52, W53, then 2027-W01.
    [InlineData(RangeType.IsoWeek, "2026-W52", "2027-W01", null, 3)]
    [InlineData(RangeType.IsoWeek, "2026-45", "2027-02", "{yyyy}-{ww}", 11)]
    [InlineData(RangeType.Date, "2026-02-27", "2026-03-02", null, 4)]
    [InlineData(RangeType.Date, "27.02.2026", "02.03.2026", "{dd}.{mm}.{yyyy}", 4)]
    public void CountValues_MatchesTheRuntimeRangeExpansion(RangeType type, string from, string to, string? format, long expected)
    {
        var source = new RangeSource { Type = type, From = from, To = to, Format = format };
        Assert.Equal(expected, RangeFormat.CountValues(source));
    }

    [Fact]
    public void CountValues_TodayAsTo_ResolvesAgainstTheClock()
    {
        var yesterday = DateTime.Today.AddDays(-1).ToString("yyyy-MM-dd");
        Assert.Equal(2, RangeFormat.CountValues(new RangeSource { Type = RangeType.Date, From = yesterday, To = "today" }));

        var thisWeek = System.Globalization.ISOWeek.GetYear(DateTime.Today) + "-W" + System.Globalization.ISOWeek.GetWeekOfYear(DateTime.Today).ToString("00");
        Assert.Equal(1, RangeFormat.CountValues(new RangeSource { Type = RangeType.IsoWeek, From = thisWeek, To = "today" }));
    }

    [Theory]
    [InlineData(RangeType.IsoWeek, "garbage", "2026-W40")]
    [InlineData(RangeType.IsoWeek, "2027-W53", "2027-W53")] // 2027 only has 52 ISO weeks
    [InlineData(RangeType.Date, "2026-13-01", "2026-12-01")]
    [InlineData(RangeType.Number, "a", "5")]
    public void CountValues_UnparsableValue_ReturnsNull(RangeType type, string from, string to)
    {
        Assert.Null(RangeFormat.CountValues(new RangeSource { Type = type, From = from, To = to }));
    }
}
