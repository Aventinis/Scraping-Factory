using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends;

// The extra time (on top of the verifier's base timeout) a trial run of this plan can legitimately need, summed from:
// browser actions (every ScrollStep / WaitForStep plus the nested Actions of BrowserDiscoverySource parameters, which
// run as their own sessions and are not in plan.Steps) and the API request count (one sequential request per parameter
// combination).
public static class VerificationTimeEstimator
{
    // Budget per API request beyond the first: generous, but with VerificationPolicy's 10-minute cap about 600 combinations are
    // still verified for real; beyond that the trial run is skipped. A constant, not a setting: it is an estimate. Request
    // delay and retry waits are not counted (the verifier extends its deadline for those at run time).
    public const long AssumedMsPerApiRequest = 1000;

    // A parameter whose count is only known at run time contributes no information: it does not multiply.
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
