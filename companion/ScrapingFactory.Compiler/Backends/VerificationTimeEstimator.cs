using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends;

// How much *extra* time (on top of the verifier's own base timeout) a
// /generate trial run of this plan can legitimately need — extracted from
// Program.cs (Issue #295) so it can be unit tested. Two independent costs
// are summed:
//   - browser actions (Issue #289): every ScrollStep/WaitForStep, plus every
//     BrowserDiscoverySource parameter's nested Actions (Issue #216) — those
//     run as their own sequential Playwright sessions and never pass through
//     ScrapingPlanBuilder's step translation, so a plain plan.Steps scan
//     doesn't see them;
//   - API request count (Issue #295): API mode sends one real, sequential
//     HTTP request per parameter combination, so a large cartesian product
//     of value lists/ranges alone can exceed the base timeout without a
//     single browser action being involved.
public static class VerificationTimeEstimator
{
    // Budget for one API request beyond the first. Deliberately generous
    // (a slow public API answers in a few hundred ms, the script's own
    // per-request timeout is 10 s) without making a legitimately large but
    // fast configuration look absurdly expensive: with Program.cs's
    // 10-minute cap this allows roughly 600 combinations to still be
    // verified for real, beyond that the trial run is skipped (the same
    // header/toast path Issue #289 already built). A fixed constant rather
    // than a configuration knob — it is an estimate, not a tuning parameter,
    // and anyone whose target is slower than this loses nothing but the
    // trial run itself. Request delay (#222) and retry waits (#223) are
    // deliberately not added here: PythonScriptVerifier already extends its
    // own deadline for every pause/retry the script announces at run time.
    public const long AssumedMsPerApiRequest = 1000;

    // What a parameter whose value count is only known at run time
    // (DiscoverySource/BrowserDiscoverySource) contributes to the
    // combination count: no information, so "doesn't multiply".
    private const long UnknownParameterValueCount = 1;

    public static long EstimateExtraMs(ScrapingPlan plan)
    {
        var ms = plan.Steps.OfType<ScrollStep>().Sum(step => (long)step.MaxIterations * step.WaitAfterMs)
            + plan.Steps.OfType<WaitForStep>().Sum(step => (long)step.TimeoutMs);

        var apiCallStep = plan.Steps.OfType<ApiCallStep>().SingleOrDefault();
        if (apiCallStep is null)
            return ms;

        foreach (var parameter in apiCallStep.Config.Parameters)
        {
            if (parameter.Source is not BrowserDiscoverySource { Actions: { } actions })
                continue;
            ms += actions.OfType<ScrollAction>().Sum(action => (long)action.MaxIterations * action.WaitAfterMs)
                + actions.OfType<WaitForAction>().Sum(action => (long)action.TimeoutMs);
        }

        var extraRequests = CountApiCombinations(apiCallStep.Config) - 1;
        if (extraRequests > 0)
            ms = SaturatingAdd(ms, SaturatingMultiply(extraRequests, AssumedMsPerApiRequest));
        return ms;
    }

    // The cartesian product of every parameter's value count (a parameter
    // that resolves to zero values makes the product zero, i.e. no request
    // at all — reported as 0, callers only act on counts above 1).
    public static long CountApiCombinations(ApiConfig config)
    {
        var combinations = 1L;
        foreach (var parameter in config.Parameters)
            combinations = SaturatingMultiply(combinations, CountParameterValues(parameter.Source));
        return combinations;
    }

    private static long CountParameterValues(ApiParameterSource source) => source switch
    {
        StaticListSource list => list.Values.Count,
        RangeSource range => RangeFormat.CountValues(range) ?? UnknownParameterValueCount,
        _ => UnknownParameterValueCount,
    };

    private static long SaturatingMultiply(long a, long b)
    {
        if (a == 0 || b == 0)
            return 0;
        return a > long.MaxValue / b ? long.MaxValue : a * b;
    }

    private static long SaturatingAdd(long a, long b) => a > long.MaxValue - b ? long.MaxValue : a + b;
}
