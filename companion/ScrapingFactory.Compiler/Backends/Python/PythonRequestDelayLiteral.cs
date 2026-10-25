using System.Globalization;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Builds the `request_delay.*` Scriban context: bounds as Python float literals in seconds. The same pacing also
// serves "honor robots.txt Crawl-delay" on its own (a 0..0 base pause), so every `request_delay.enabled` call site
// needs no change; robots_urls are the start URLs (or the API template) the runtime reduces to origins.
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
