using System.Globalization;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Issue #223: builds the single Scriban context object every request-making
// template renders `retry.*` from — mirrors PythonRequestDelayLiteral.
// Seconds as Python float literals (the runtime's time.sleep unit); the
// status codes as a Python set literal.
internal static class PythonRetryLiteral
{
    public static object BuildContext(RetryConfig? retry) => retry is null
        ? new { enabled = false, max_attempts = 1, delay_s_literal = "0.0", exponential_literal = "False", max_wait_s_literal = "0.0", status_codes_literal = "set()" }
        : new
        {
            enabled = true,
            max_attempts = retry.MaxAttempts,
            delay_s_literal = Seconds(retry.DelayMs),
            exponential_literal = retry.Exponential ? "True" : "False",
            max_wait_s_literal = Seconds(RetryConfig.MaxWaitMs),
            status_codes_literal = "{" + string.Join(", ", retry.EffectiveStatusCodes.Order()) + "}",
        };

    private static string Seconds(int ms) => (ms / 1000.0).ToString("0.0##", CultureInfo.InvariantCulture);
}
