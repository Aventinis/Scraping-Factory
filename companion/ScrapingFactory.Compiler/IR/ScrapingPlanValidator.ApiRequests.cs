using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.Backends.Python;

namespace ScrapingFactory.Compiler.IR;

public static partial class ScrapingPlanValidator
{
    // Issue #321: see ApiLinkHeaderPagination's own doc comment.
    private static string? ValidateApiLinkHeaderPagination(ApiConfig api, ApiLinkHeaderPagination linkPagination)
    {
        if (linkPagination.MaxPages <= 0)
            return "Link-header pagination's MaxPages must be greater than 0.";
        if (api.CursorPagination is not null)
            return "Link-header pagination can't be combined with cursor pagination — pick one way of finding the next page.";
        if (api.EmbeddedJsonSource is not null)
            return "Link-header pagination can't be combined with an embedded JSON source — a page load has no Link header to follow.";
        if (api.Method != "GET")
            return "Link-header pagination requires method 'GET' — the next page is requested by URL alone.";
        return null;
    }

    // Issue #224: see ApiCursorPagination's own doc comment.
    private static string? ValidateApiCursorPagination(ApiConfig api, ApiCursorPagination cursor)
    {
        if (string.IsNullOrWhiteSpace(cursor.NextCursorPath))
            return "Cursor pagination needs a NextCursorPath.";
        if (cursor.HasNextPagePath is not null && string.IsNullOrWhiteSpace(cursor.HasNextPagePath))
            return "Cursor pagination's HasNextPagePath must not be blank when set.";
        if (cursor.MaxPages <= 0)
            return "Cursor pagination's MaxPages must be greater than 0.";
        if (api.EmbeddedJsonSource is not null)
            return "Cursor pagination can't be combined with an embedded JSON source — a page load has no cursor to follow.";

        switch (cursor.Target)
        {
            case ApiCursorTarget.Query:
                if (string.IsNullOrWhiteSpace(cursor.QueryParameterName))
                    return "Cursor pagination with target 'Query' needs a QueryParameterName.";
                if (cursor.QueryParameterName.Any(c => char.IsWhiteSpace(c) || c is '&' or '=' or '#' or '?'))
                    return $"Invalid cursor query parameter name '{cursor.QueryParameterName}'.";
                break;
            case ApiCursorTarget.Body:
                if (api.Method != "POST" || api.Body is null)
                    return "Cursor pagination with target 'Body' requires method 'POST' with a request body.";
                if (string.IsNullOrWhiteSpace(cursor.BodyPath))
                    return "Cursor pagination with target 'Body' needs a BodyPath.";
                if (cursor.BodyPath.Split('.').Any(string.IsNullOrWhiteSpace) || cursor.BodyPath.Contains('['))
                    return $"Invalid cursor BodyPath '{cursor.BodyPath}': use dot-separated object keys only.";
                break;
        }
        return null;
    }

    // Issue #220: see ApiBootstrap's own doc comment. The value name itself
    // is checked against EnvironmentVariableNamePattern too — it has to be a
    // valid Python str.format() keyword (it's substituted into UrlTemplate
    // via URL_TEMPLATE.format(**...)), which is exactly the same
    // identifier-shaped character set.
    private static string? ValidateApiBootstrap(ApiBootstrap bootstrap)
    {
        if (string.IsNullOrWhiteSpace(bootstrap.Name))
            return "Bootstrap value needs a name.";
        if (!EnvironmentVariableNamePattern.IsMatch(bootstrap.Name))
            return $"Invalid bootstrap value name '{bootstrap.Name}': use letters, digits and underscores only.";
        if (bootstrap.Method is not ("GET" or "POST"))
            return $"Unsupported bootstrap request method '{bootstrap.Method}': expected GET or POST.";
        if (!Uri.TryCreate(bootstrap.Url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            return $"Invalid bootstrap request URL '{bootstrap.Url}'.";
        if (UrlTemplatePlaceholderPattern.IsMatch(bootstrap.Url))
            return "Bootstrap request URL must not contain placeholders — it runs before any parameter is resolved.";
        if (string.IsNullOrWhiteSpace(bootstrap.ValuePath))
            return "Bootstrap request needs a ValuePath.";

        if (bootstrap.BodyFields is { Count: > 0 } bodyFields)
        {
            if (bootstrap.Method != "POST")
                return "Bootstrap body fields require method 'POST'.";
            foreach (var field in bodyFields)
            {
                if (string.IsNullOrWhiteSpace(field.Name))
                    return "Name of a bootstrap body field must not be empty.";
                var hasEnvironmentVariable = !string.IsNullOrWhiteSpace(field.EnvironmentVariableName);
                if ((field.Value is not null) == hasEnvironmentVariable)
                    return $"Bootstrap body field '{field.Name}' needs exactly one of Value/EnvironmentVariableName.";
                if (hasEnvironmentVariable && !EnvironmentVariableNamePattern.IsMatch(field.EnvironmentVariableName!))
                    return $"Invalid environment variable name '{field.EnvironmentVariableName}' in bootstrap body field '{field.Name}'.";
            }
            var duplicateBodyFields = FindDuplicates(bodyFields, field => field.Name);
            if (duplicateBodyFields.Count > 0)
                return $"Duplicate bootstrap body field names: {string.Join(", ", duplicateBodyFields)}.";
        }

        if (bootstrap.Headers is { } bootstrapHeaders)
        {
            if (bootstrapHeaders.Any(header => header.Template is not null))
                return "Bootstrap request headers cannot use a template — the bootstrap value doesn't exist yet when this request is sent.";
            var headerError = ValidateApiHeaders(bootstrapHeaders, bootstrapName: null);
            if (headerError is not null)
                return $"Bootstrap request: {headerError}";
        }
        return null;
    }
}
