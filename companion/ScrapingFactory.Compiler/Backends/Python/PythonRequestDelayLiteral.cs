using System.Globalization;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Issue #222: builds the single Scriban context object every request-making
// template renders `request_delay.*` from — mirrors PythonProxyLiteral. The
// bounds are rendered as Python float literals in seconds (the runtime's
// time.sleep/random.uniform unit), always with a decimal point.
//
// Issue #228: the same pacing mechanism also serves "honor robots.txt
// Crawl-delay/Request-rate" — that setting alone (no explicit pause) enables
// it with a 0..0 base pause, so every call site of _pace_request that was
// already gated on `request_delay.enabled` needs no change. `robots_urls`
// are the plan's start URLs (or the API URL template); the runtime reduces
// them to origins and reads each one's robots.txt once.
internal static class PythonRequestDelayLiteral
{
    public static object BuildContext(ScrapingPlan plan)
    {
        var respect = plan.RespectRobotsDelay;
        var delay = plan.RequestDelay;
        if (delay is null && !respect)
            return new { enabled = false, min_s_literal = "0.0", max_s_literal = "0.0", respect_robots = false, robots_urls_literal = "[]" };

        return new
        {
            enabled = true,
            min_s_literal = Seconds(delay?.MinMs ?? 0),
            max_s_literal = Seconds(delay?.MaxMs ?? 0),
            respect_robots = respect,
            robots_urls_literal = respect ? PythonLiteral.StrList(RobotsUrls(plan)) : "[]",
        };
    }

    private static IReadOnlyList<string> RobotsUrls(ScrapingPlan plan)
    {
        var urls = new List<string>();
        foreach (var step in plan.Steps)
        {
            if (step is NavigateStep navigate) urls.AddRange(navigate.Urls);
            else if (step is ApiCallStep api) urls.Add(api.Config.UrlTemplate);
        }
        return urls;
    }

    private static string Seconds(int ms) => (ms / 1000.0).ToString("0.0##", CultureInfo.InvariantCulture);
}
