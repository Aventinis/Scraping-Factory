using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.Backends.Python;

namespace ScrapingFactory.Compiler.IR;

public static partial class ScrapingPlanValidator
{
    // Issue #217: only DiscoverySource/BrowserDiscoverySource have a
    // template string a {name} placeholder could even appear in —
    // StaticListSource/RangeSource have no such field, so they can never
    // depend on anything (out of scope per the issue's own open
    // questions) and this returns null immediately for them. A placeholder
    // naming something that isn't a declared parameter at all is left
    // alone (same laissez-faire ValidateDiscoverySource's own doc comment
    // already establishes for an otherwise-unrelated template) — only a
    // name that IS a declared parameter, just not one declared before this
    // one, is actually rejected.
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

    // DiscoverySource.UrlTemplate may now reference an earlier-declared
    // parameter's own value (Issue #217, validated above) — otherwise it's
    // still expected to be fully static, same as before that existed.
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

    // Unlike the CSS-selector/JSON-path laissez-faire elsewhere in this
    // validator, a Range's From/To/Format are plain user-typed strings with
    // a fully deterministic syntax (no library-compatibility ambiguity to
    // punt on) — so, same as EnvironmentVariableNamePattern above, checking
    // them here is cheap and catches a real bug class: a From/To value that
    // doesn't match its (possibly default) Format used to only fail deep
    // inside the generated script (raw Python traceback, e.g. a site using
    // "2026-35" instead of ISO-8601 "2026-W35" for a week number).
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
        // See RangeFormat.IsValid's doc comment for why allowToday differs
        // between From and To here.
        if (!RangeFormat.IsValid(range.From, format, allowToday: range.Type == RangeType.IsoWeek))
            return $"Start value '{range.From}' for parameter '{parameterName}' does not match format '{format}'.";
        if (!RangeFormat.IsValid(range.To, format, allowToday: true))
            return $"End value '{range.To}' for parameter '{parameterName}' does not match format '{format}'.";

        return null;
    }

    // Issue #216: DiscoveryUrl is the page actually opened/scrolled — unlike
    // UrlTemplate (checked separately, see the call site above), it needs no
    // cross-check against api.Parameters here (that's ValidateParameterDependencyOrder's
    // job, called before this): Uri.TryCreate(..., UriKind.Absolute, ...)
    // happily parses a "{name}"-templated string too (confirmed: curly
    // braces don't make .NET's Uri parser reject an otherwise well-formed
    // absolute URL), so the same plain absolute-URI check already works
    // whether or not this Issue #217 chaining is actually used, mirroring
    // the NavigateStep URL check at the top of this validator. Each action
    // is validated the same way its plan-level
    // WaitForStep/FillStep/ClickStep/ScrollStep counterpart already is above
    // — duplicated rather than shared, since those checks run against
    // ScrapingStep (post-ScrapingPlanBuilder translation), not the
    // wire-level BrowserAction this list is made of. FramePath is validated
    // against a literal ScrapingEngine.Browser regardless of plan.Engine
    // (always ScrapingEngine.Api here) — this action list always runs
    // inside its own dedicated Playwright session, independent of whatever
    // engine the main request itself uses.
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
