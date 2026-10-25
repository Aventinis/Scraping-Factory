using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.Backends.Python;

namespace ScrapingFactory.Compiler.IR;

// Fast, in-process structural checks on a ScrapingPlan, run before code generation and the (expensive) trial run: they
// reject configurations that are wrong whatever the generated script does. CSS selector syntax is deliberately not
// checked (Architecture Decision #3); only the trial run proves a selector works. Split by area into the
// ScrapingPlanValidator.*.cs files; every check returns an error message or null.
public static partial class ScrapingPlanValidator
{
    public static PlanValidationResult Validate(ScrapingPlan plan)
    {
        // The order of the checks decides which error a doubly-wrong plan reports first; keep it.
        var error = ValidateStartUrls(plan)
            ?? ValidateSettings(plan)
            ?? ValidateBrowserSteps(plan);
        if (error is not null)
            return Invalid(error);

        // Exactly one extraction shape is present; ScrapingPlanBuilder never mixes them.
        error = plan.Steps.OfType<ExtractionBlockStep>().SingleOrDefault() is { } blockStep ? ValidateExtractionBlocks(blockStep.Blocks, plan.Engine)
            : plan.Steps.OfType<ExtractGroupStep>().SingleOrDefault() is { } groupStep ? ValidateContainerPlan(plan, groupStep)
            : plan.Steps.OfType<ApiCallStep>().SingleOrDefault() is { } apiStep ? ValidateApiPlan(plan, apiStep)
            : ValidateFlatPlan(plan);
        return error is null ? new PlanValidationResult { Success = true } : Invalid(error);
    }

    private static string? ValidateStartUrls(ScrapingPlan plan)
    {
        if (plan.Steps.Count == 0 || plan.Steps[0] is not NavigateStep navigate)
            return "Plan must start with a NavigateStep.";

        if (plan.Steps.Skip(1).Any(step => step is NavigateStep))
            return "Plan must not contain more than one NavigateStep.";

        if (navigate.Urls.Count == 0)
            return "NavigateStep must contain at least one URL.";

        for (var i = 0; i < navigate.Urls.Count; i++)
        {
            var url = navigate.Urls[i];
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
                (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            {
                return $"Invalid start URL #{i + 1} '{url}': must be an absolute http(s) URL.";
            }
        }

        return null;
    }

    private static readonly Regex EnvironmentVariableNamePattern = new("^[A-Za-z_][A-Za-z0-9_]*$");

    private static PlanValidationResult Invalid(string error) => new() { Success = false, Error = error };

    private static List<string> FindDuplicates<T>(IEnumerable<T> items, Func<T, string> keySelector) =>
        items.GroupBy(keySelector).Where(group => group.Count() > 1).Select(group => group.Key).ToList();

    // Shared by ExtractStep.FramePath and GroupNode/DataFieldNode.FramePath
    // (Issue #42) — same three checks regardless of which node type carries
    // the FramePath.
    private static string? ValidateFramePath(List<string>? framePath, string context, ScrapingEngine engine)
    {
        if (framePath is null)
            return null;
        if (engine != ScrapingEngine.Browser)
            return $"FramePath for {context} requires Engine 'Browser'.";
        if (framePath.Count == 0)
            return $"FramePath for {context} must not be empty when set.";
        if (framePath.Any(string.IsNullOrWhiteSpace))
            return $"FramePath for {context} must not contain empty segments.";
        return framePath.Select(segment => SelectorTextFilter.ValidateNotAllowed(segment, $"FramePath for {context}")).FirstOrDefault(error => error is not null);
    }
}
