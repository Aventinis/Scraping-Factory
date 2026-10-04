using System.Globalization;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Issue #222: builds the single Scriban context object every request-making
// template renders `request_delay.*` from — mirrors PythonProxyLiteral. The
// bounds are rendered as Python float literals in seconds (the runtime's
// time.sleep/random.uniform unit), always with a decimal point.
internal static class PythonRequestDelayLiteral
{
    public static object BuildContext(RequestDelayConfig? requestDelay) => requestDelay is null
        ? new { enabled = false, min_s_literal = "0.0", max_s_literal = "0.0" }
        : new { enabled = true, min_s_literal = Seconds(requestDelay.MinMs), max_s_literal = Seconds(requestDelay.MaxMs) };

    private static string Seconds(int ms) => (ms / 1000.0).ToString("0.0##", CultureInfo.InvariantCulture);
}
