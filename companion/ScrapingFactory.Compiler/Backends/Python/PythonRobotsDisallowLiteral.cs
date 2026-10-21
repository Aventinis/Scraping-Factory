using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Issue #333: builds the single Scriban context object every request-making
// template renders `robots_check.*` from — mirrors PythonRequestDelayLiteral.
// `action` is the PascalCase enum name ("Warn"/"Skip"/"Abort"), the same
// string-vocabulary convention TransformErrorMode/HardeningCheck.Severity
// use, compared verbatim by the runtime.
internal static class PythonRobotsDisallowLiteral
{
    public static object BuildContext(ScrapingPlan plan) => plan.RobotsDisallow is null
        ? new { enabled = false, action_literal = "\"Skip\"" }
        : new { enabled = true, action_literal = PythonLiteral.Str(plan.RobotsDisallow.Action.ToString()) };
}
