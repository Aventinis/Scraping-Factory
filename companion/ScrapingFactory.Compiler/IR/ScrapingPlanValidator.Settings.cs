using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.Backends.Python;

namespace ScrapingFactory.Compiler.IR;

public static partial class ScrapingPlanValidator
{
    // RFC 9110 token characters — what an HTTP header field name may consist of.
    private static readonly Regex HeaderNamePattern = new("^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+$");

    // DOM-mode counterpart of ValidateApiHeaders: no Template (there is no bootstrap value), the name must be an HTTP token, a value
    // must not contain a line break, and duplicates are compared case-insensitively.
    private static string? ValidateRequestHeaders(List<ApiHeader> headers)
    {
        foreach (var header in headers)
        {
            if (string.IsNullOrWhiteSpace(header.Name))
                return "Name of a request header must not be empty.";
            if (!HeaderNamePattern.IsMatch(header.Name))
                return $"Invalid request header name '{header.Name}' — use only letters, digits and the characters !#$%&'*+-.^_`|~.";

            if (!string.IsNullOrWhiteSpace(header.Template))
                return $"Request header '{header.Name}' must not use a template — templates only exist for an API-mode auth bootstrap.";

            var hasValue = !string.IsNullOrWhiteSpace(header.Value);
            var hasEnvironmentVariable = !string.IsNullOrWhiteSpace(header.EnvironmentVariableName);
            if (hasValue == hasEnvironmentVariable)
                return $"Request header '{header.Name}' needs exactly one of Value/EnvironmentVariableName.";

            if (hasValue && header.Value!.IndexOfAny(['\r', '\n']) >= 0)
                return $"Value of request header '{header.Name}' must not contain a line break.";
            if (hasEnvironmentVariable && !EnvironmentVariableNamePattern.IsMatch(header.EnvironmentVariableName!))
                return $"Invalid environment variable name '{header.EnvironmentVariableName}' in request header '{header.Name}'.";
        }

        var duplicates = headers.GroupBy(header => header.Name.ToLowerInvariant()).Where(group => group.Count() > 1).Select(group => group.Key).ToList();
        if (duplicates.Count > 0)
            return $"Duplicate request header names: {string.Join(", ", duplicates)}.";

        return null;
    }

    // Every field is an environment variable name, never a literal value.
    private static string? ValidateChangeDetection(ChangeDetectionConfig changeDetection)
    {
        if (changeDetection.Notify is not ("Email" or "Webhook"))
            return $"Unsupported notify method '{changeDetection.Notify}': expected 'Email' or 'Webhook'.";

        if (changeDetection.Notify == "Email")
        {
            if (changeDetection.Email is null)
                return "ChangeDetection with Notify 'Email' needs an Email configuration.";
            if (changeDetection.Webhook is not null)
                return "ChangeDetection must not configure both Email and Webhook.";

            var email = changeDetection.Email;
            var requiredNames = new (string Value, string Field)[]
            {
                (email.SmtpHostEnvVar, "SmtpHostEnvVar"), (email.FromEnvVar, "FromEnvVar"), (email.ToEnvVar, "ToEnvVar"),
            };
            foreach (var (value, field) in requiredNames)
            {
                if (!EnvironmentVariableNamePattern.IsMatch(value))
                    return $"Invalid environment variable name '{value}' in ChangeDetection.Email.{field}.";
            }

            var optionalNames = new (string? Value, string Field)[]
            {
                (email.SmtpPortEnvVar, "SmtpPortEnvVar"),
                (email.SmtpUsernameEnvVar, "SmtpUsernameEnvVar"),
                (email.SmtpPasswordEnvVar, "SmtpPasswordEnvVar"),
            };
            foreach (var (value, field) in optionalNames)
            {
                if (value is not null && !EnvironmentVariableNamePattern.IsMatch(value))
                    return $"Invalid environment variable name '{value}' in ChangeDetection.Email.{field}.";
            }

            return null;
        }

        if (changeDetection.Webhook is null)
            return "ChangeDetection with Notify 'Webhook' needs a Webhook configuration.";

        return EnvironmentVariableNamePattern.IsMatch(changeDetection.Webhook.UrlEnvVar)
            ? null
            : $"Invalid environment variable name '{changeDetection.Webhook.UrlEnvVar}' in ChangeDetection.Webhook.UrlEnvVar.";
    }

    // Only the variable name is validated; the companion never sees the proxy URLs.
    private static string? ValidateProxy(ProxyConfig proxy) =>
        EnvironmentVariableNamePattern.IsMatch(proxy.EnvironmentVariableName)
            ? null
            : $"Invalid environment variable name '{proxy.EnvironmentVariableName}' in Proxy.EnvironmentVariableName.";

    // MaxPages applies to both kinds; a page-number template must reference "{url}" and "{page}".
    private static string? ValidatePagination(PaginationConfig pagination, bool singleStartPage)
    {
        if (pagination.MaxPages <= 0)
            return $"Pagination.MaxPages must be positive (was {pagination.MaxPages}).";

        return pagination switch
        {
            NextLinkPagination nextLink => string.IsNullOrWhiteSpace(nextLink.NextLinkSelector)
                ? "NextLinkPagination.NextLinkSelector must not be empty."
                : SelectorTextFilter.Validate(nextLink.NextLinkSelector, "NextLinkPagination.NextLinkSelector"),
            PageNumberPagination pageNumber => ValidatePageNumberUrlTemplate(pageNumber.UrlTemplate, singleStartPage),
            _ => throw new InvalidOperationException($"Unknown PaginationConfig type: {pagination.GetType()}"),
        };
    }

    // "{page}" is always required (else the same URL is refetched). "{url}" is only required with several start pages, because a
    // template written out in full would request the same page N for each of them.
    private static string? ValidatePageNumberUrlTemplate(string urlTemplate, bool singleStartPage)
    {
        if (string.IsNullOrWhiteSpace(urlTemplate))
            return "PageNumberPagination.UrlTemplate must not be empty.";

        var placeholders = UrlTemplatePlaceholderPattern.Matches(urlTemplate).Select(match => match.Groups[1].Value).ToHashSet();
        var required = singleStartPage ? new[] { "page" } : new[] { "url", "page" };
        var missing = required.Where(token => !placeholders.Contains(token)).ToList();
        return missing.Count > 0
            ? $"PageNumberPagination.UrlTemplate is missing placeholder(s): {string.Join(", ", missing.Select(token => $"{{{token}}}"))}."
            : null;
    }

    // PageUrl is a concrete address (no placeholders). LinkSelector syntax is not checked, like any other selector.
    private static string? ValidateDiscoveredUrls(DiscoveredUrlsConfig discoveredUrls)
    {
        if (!Uri.TryCreate(discoveredUrls.PageUrl, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            return "DiscoveredUrls needs an absolute http(s) PageUrl.";
        }
        if (string.IsNullOrWhiteSpace(discoveredUrls.LinkSelector))
            return "DiscoveredUrls.LinkSelector must not be empty.";
        var linkSelectorError = SelectorTextFilter.Validate(discoveredUrls.LinkSelector, "DiscoveredUrls.LinkSelector");
        if (linkSelectorError is not null)
            return linkSelectorError;
        if (discoveredUrls.MaxUrls <= 0)
            return $"DiscoveredUrls.MaxUrls must be positive (was {discoveredUrls.MaxUrls}).";
        return null;
    }

    // The cross-cutting settings every shape can carry (Api plans simply never have some of them), in a fixed order.
    private static string? ValidateSettings(ScrapingPlan plan)
    {
        var startUrlCount = plan.Steps.OfType<NavigateStep>().Sum(step => step.Urls.Count);

        return (plan.ChangeDetection is { } changeDetection ? ValidateChangeDetection(changeDetection) : null)
            ?? ValidateTabularOutput(plan)
            ?? (plan.Proxy is { } proxy ? ValidateProxy(proxy) : null)
            ?? (plan.RequestDelay is { } requestDelay ? ValidateRequestDelay(requestDelay) : null)
            ?? (plan.Retry is { } retry ? ValidateRetry(retry) : null)
            ?? (plan.Headers is { Count: > 0 } headers ? ValidateRequestHeaders(headers) : null)
            ?? (plan.Hardening is { Count: > 0 } hardening ? ValidateHardening(hardening) : null)
            // "{url}" in a page-number template is only optional with exactly one start page.
            ?? (plan.Pagination is { } pagination ? ValidatePagination(pagination, singleStartPage: startUrlCount <= 1 && plan.DiscoveredUrls is null) : null)
            ?? (plan.DiscoveredUrls is { } discoveredUrls ? ValidateDiscoveredUrls(discoveredUrls) : null)
            ?? (plan.PersistentSession && plan.Engine != ScrapingEngine.Browser ? "PersistentSession requires Engine 'Browser'." : null);
    }

    private static string? ValidateRequestDelay(RequestDelayConfig requestDelay)
    {
        if (requestDelay.MinMs < 0)
            return "RequestDelay.MinMs must not be negative.";
        if (requestDelay.MaxMs < requestDelay.MinMs)
            return "RequestDelay.MaxMs must not be smaller than RequestDelay.MinMs.";
        if (requestDelay.MaxMs > RequestDelayConfig.MaxAllowedMs)
            return $"RequestDelay.MaxMs must not exceed {RequestDelayConfig.MaxAllowedMs} ms (one minute per pause).";
        return null;
    }

    private static string? ValidateRetry(RetryConfig retry)
    {
        if (retry.MaxAttempts is < RetryConfig.MinAllowedAttempts or > RetryConfig.MaxAllowedAttempts)
            return $"Retry.MaxAttempts must be between {RetryConfig.MinAllowedAttempts} and {RetryConfig.MaxAllowedAttempts}.";
        if (retry.DelayMs is < 0 or > RetryConfig.MaxWaitMs)
            return $"Retry.DelayMs must be between 0 and {RetryConfig.MaxWaitMs} ms.";
        if (retry.RetryOnStatusCodes is { } codes)
        {
            if (codes.Any(code => code is < 400 or > 599))
                return "Retry.RetryOnStatusCodes may only contain HTTP error status codes (400-599).";
            if (codes.Distinct().Count() != codes.Count)
                return "Retry.RetryOnStatusCodes must not contain duplicates.";
        }
        return null;
    }
}
