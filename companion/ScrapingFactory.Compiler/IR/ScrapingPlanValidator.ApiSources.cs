using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.Backends.Python;

namespace ScrapingFactory.Compiler.IR;

public static partial class ScrapingPlanValidator
{
    // Only discovery sources have a template a {name} placeholder can appear in. A placeholder that is not a declared parameter is left
    // alone; one that names a parameter declared later is rejected.
    private static string? ValidateParameterDependencyOrder(
        ApiParameter parameter, HashSet<string> declaredSoFar, HashSet<string> allParameterNames)
    {
        var template = parameter.Source switch
        {
            DiscoverySource discovery => discovery.UrlTemplate,
            BrowserDiscoverySource browserDiscovery => browserDiscovery.DiscoveryUrl,
            _ => null,
        };
        if (template is null)
            return null;

        foreach (Match match in UrlTemplatePlaceholderPattern.Matches(template))
        {
            var referenced = match.Groups[1].Value;
            if (!allParameterNames.Contains(referenced))
                continue;
            if (referenced == parameter.Name)
                return $"Parameter '{parameter.Name}' cannot reference itself.";
            if (!declaredSoFar.Contains(referenced))
                return $"Parameter '{parameter.Name}' references '{referenced}', which is declared later — a parameter can only depend on an earlier-declared parameter.";
        }
        return null;
    }

    // May reference an earlier-declared parameter (checked above); otherwise it is expected to be static.
    private static string? ValidateDiscoverySource(string parameterName, DiscoverySource discovery)
    {
        if (discovery.Method != "GET")
            return $"Discovery endpoint for parameter '{parameterName}': Api mode currently only supports GET.";
        if (string.IsNullOrWhiteSpace(discovery.UrlTemplate))
            return $"Discovery endpoint for parameter '{parameterName}' needs a UrlTemplate.";
        if (string.IsNullOrWhiteSpace(discovery.ItemsPath))
            return $"Discovery endpoint for parameter '{parameterName}' needs an ItemsPath.";
        if (string.IsNullOrWhiteSpace(discovery.ValuePath))
            return $"Discovery endpoint for parameter '{parameterName}' needs a ValuePath.";
        return null;
    }

    // Unlike selectors, a Range's From/To/Format have a deterministic syntax, so a mismatch is caught here instead of as a Python traceback.
    private static string? ValidateRangeSource(string parameterName, RangeSource range)
    {
        if (string.IsNullOrWhiteSpace(range.From) || string.IsNullOrWhiteSpace(range.To))
            return $"Range for parameter '{parameterName}' needs a start and an end.";

        if (range.Type == RangeType.Number)
        {
            if (!int.TryParse(range.From, out _))
                return $"Start value '{range.From}' for parameter '{parameterName}' is not an integer.";
            if (!int.TryParse(range.To, out _))
                return $"End value '{range.To}' for parameter '{parameterName}' is not an integer.";
            return null;
        }

        var formatError = RangeFormat.ValidateFormat(range.Type, range.Format);
        if (formatError is not null)
            return $"Format for parameter '{parameterName}': {formatError}";

        var format = RangeFormat.Resolve(range.Type, range.Format);
        // allowToday differs between From and To (see RangeFormat.IsValid).
        if (!RangeFormat.IsValid(range.From, format, allowToday: range.Type == RangeType.IsoWeek))
            return $"Start value '{range.From}' for parameter '{parameterName}' does not match format '{format}'.";
        if (!RangeFormat.IsValid(range.To, format, allowToday: true))
            return $"End value '{range.To}' for parameter '{parameterName}' does not match format '{format}'.";

        return null;
    }

    // DiscoveryUrl may contain {name} placeholders (ValidateParameterDependencyOrder checks them), which the absolute-URI check accepts.
    // The actions are validated like their plan-level counterparts, duplicated because this list is wire-level BrowserAction; the
    // FramePath check uses the Browser engine because the list always runs in its own Playwright session.
    private static string? ValidateBrowserDiscoverySource(string parameterName, BrowserDiscoverySource source)
    {
        if (!Uri.TryCreate(source.DiscoveryUrl, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            return $"Browser discovery for parameter '{parameterName}' needs an absolute http(s) DiscoveryUrl.";
        }

        foreach (var action in source.Actions ?? [])
        {
            var actionError = action switch
            {
                WaitForAction wait => string.IsNullOrWhiteSpace(wait.Selector)
                    ? $"Selector of a WaitForAction in browser discovery for parameter '{parameterName}' must not be empty."
                    : wait.TimeoutMs <= 0
                        ? $"Timeout of a WaitForAction in browser discovery for parameter '{parameterName}' must be positive."
                        : ValidateFramePath(wait.FramePath, "WaitForAction", ScrapingEngine.Browser),
                FillAction fill => string.IsNullOrWhiteSpace(fill.Selector)
                    ? $"Selector of a FillAction in browser discovery for parameter '{parameterName}' must not be empty."
                    : !EnvironmentVariableNamePattern.IsMatch(fill.EnvironmentVariableName)
                        ? $"Invalid environment variable name '{fill.EnvironmentVariableName}' in browser discovery for parameter '{parameterName}'."
                        : ValidateFramePath(fill.FramePath, "FillAction", ScrapingEngine.Browser),
                ClickAction click => string.IsNullOrWhiteSpace(click.Selector)
                    ? $"Selector of a ClickAction in browser discovery for parameter '{parameterName}' must not be empty."
                    : click.WaitAfterMs < 0
                        ? $"WaitAfterMs of a ClickAction in browser discovery for parameter '{parameterName}' must not be negative."
                        : ValidateFramePath(click.FramePath, "ClickAction", ScrapingEngine.Browser),
                ScrollAction scroll => (scroll.ContainerSelector is not null && string.IsNullOrWhiteSpace(scroll.ContainerSelector))
                    ? $"ContainerSelector of a ScrollAction in browser discovery for parameter '{parameterName}' must not be empty when set."
                    : (scroll.LoadMoreButtonSelector is not null && string.IsNullOrWhiteSpace(scroll.LoadMoreButtonSelector))
                        ? $"LoadMoreButtonSelector of a ScrollAction in browser discovery for parameter '{parameterName}' must not be empty when set."
                        : scroll.MaxIterations <= 0
                            ? $"MaxIterations of a ScrollAction in browser discovery for parameter '{parameterName}' must be positive."
                            : scroll.WaitAfterMs < 0
                                ? $"WaitAfterMs of a ScrollAction in browser discovery for parameter '{parameterName}' must not be negative."
                                : scroll.ScrollStepPx is <= 0
                                    ? $"ScrollStepPx of a ScrollAction in browser discovery for parameter '{parameterName}' must be positive when set."
                                    : ValidateFramePath(scroll.FramePath, "ScrollAction", ScrapingEngine.Browser),
                _ => null,
            };
            if (actionError is not null)
                return actionError;
            var actionSelectorError = action switch
            {
                WaitForAction wait => SelectorTextFilter.Validate(wait.Selector, $"Selector of a WaitForAction in browser discovery for parameter '{parameterName}'"),
                FillAction fill => SelectorTextFilter.Validate(fill.Selector, $"Selector of a FillAction in browser discovery for parameter '{parameterName}'"),
                ClickAction click => SelectorTextFilter.Validate(click.Selector, $"Selector of a ClickAction in browser discovery for parameter '{parameterName}'"),
                ScrollAction scroll => SelectorTextFilter.Validate(scroll.ContainerSelector, $"ContainerSelector of a ScrollAction in browser discovery for parameter '{parameterName}'")
                    ?? SelectorTextFilter.Validate(scroll.LoadMoreButtonSelector, $"LoadMoreButtonSelector of a ScrollAction in browser discovery for parameter '{parameterName}'"),
                _ => null,
            };
            if (actionSelectorError is not null)
                return actionSelectorError;
        }

        return null;
    }
}
