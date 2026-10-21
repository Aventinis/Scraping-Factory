using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #295: real end-to-end proof that the estimated extra timeout is
// enough for an API configuration whose sequential requests, summed, exceed
// the verifier's base timeout — and that it really is what makes the
// difference (the same run without it times out).
public class ApiCombinationTimeoutEndToEndTests
{
    private const int Combinations = 60;
    private const int DelayPerRequestMs = 100;

    private static ScrapingPlan Plan(string baseUrl) => new()
    {
        Steps =
        [
            new NavigateStep { Urls = ["https://example.com"] },
            new ApiCallStep
            {
                Config = new ApiConfig
                {
                    UrlTemplate = $"{baseUrl}items?n={{n}}",
                    ItemsPath = "items",
                    Fields = [new ApiField { Name = "Title", Path = "title" }],
                    Parameters =
                    [
                        new ApiParameter
                        {
                            Name = "n",
                            Source = new RangeSource { Type = RangeType.Number, From = "1", To = Combinations.ToString() },
                        },
                    ],
                },
            },
        ],
        OutputFormat = OutputFormat.Csv,
        Engine = ScrapingEngine.Api,
    };

    private static LocalTestServer SlowServer() => new(request =>
    {
        Thread.Sleep(DelayPerRequestMs);
        return new LocalTestServerResponse(
            $$"""{ "items": [ { "title": "item-{{request.QueryString["n"]}}" } ] }""", "application/json");
    });

    // Base timeout (3 s) is far below the ~6 s the 60 requests take.
    private static readonly TimeSpan BaseTimeout = TimeSpan.FromSeconds(3);

    [Fact]
    public async Task EstimatedExtraTimeout_CoversASequenceOfRequestsLongerThanTheBaseTimeout()
    {
        using var server = SlowServer();
        var plan = Plan(server.BaseUrl);
        var script = new PythonApiCodeGenerator().Generate(plan);

        var result = await new PythonScriptVerifier(timeout: BaseTimeout).VerifyAsync(
            script, extraTimeout: TimeSpan.FromMilliseconds(VerificationTimeEstimator.EstimateExtraMs(plan)));

        Assert.True(result.Success, result.Error);
        Assert.Equal(Combinations, result.RowCount);
    }

    [Fact]
    public async Task WithoutTheEstimate_TheSameRunExceedsTheBaseTimeout()
    {
        using var server = SlowServer();
        var script = new PythonApiCodeGenerator().Generate(Plan(server.BaseUrl));

        var result = await new PythonScriptVerifier(timeout: BaseTimeout).VerifyAsync(script);

        Assert.False(result.Success);
        Assert.Contains("timeout", result.Error, StringComparison.OrdinalIgnoreCase);
    }
}
