using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.Backends.Python;

namespace ScrapingFactory.Compiler.IR;

public static partial class ScrapingPlanValidator
{
    private static readonly Regex UrlTemplatePlaceholderPattern = new(@"\{([^{}]+)\}");

    // JSON paths are deliberately not syntax-checked (like CSS selectors): a bad path surfaces in the trial run.
    private static string? ValidateApiConfig(ApiConfig api)
    {
        var bootstrapName = api.Bootstrap?.Name;
        return ValidateApiRequest(api)
            ?? ValidateApiResponseShape(api)
            ?? ValidateApiParameters(api, bootstrapName)
            ?? (api.CursorPagination is { } cursor ? ValidateApiCursorPagination(api, cursor) : null)
            ?? (api.LinkHeaderPagination is { } link ? ValidateApiLinkHeaderPagination(api, link) : null)
            ?? (api.Headers is { } headers ? ValidateApiHeaders(headers, bootstrapName) : null);
    }

    private static string? ValidateApiRequest(ApiConfig api)
    {
        if (api.Method is not ("GET" or "POST"))
            return $"Unsupported HTTP method '{api.Method}': Api mode currently only supports GET and POST.";

        if (api.Body is not null && api.Method != "POST")
            return "Body requires method 'POST'.";

        // A page load is always a plain GET; this also rejects Body, which already requires POST above.
        if (api.EmbeddedJsonSource is { } embeddedJsonSource)
        {
            if (api.Method != "GET")
                return "EmbeddedJsonSource requires method 'GET'.";
            if (string.IsNullOrWhiteSpace(embeddedJsonSource.ScriptSelector))
                return "EmbeddedJsonSource needs a ScriptSelector.";
            return SelectorTextFilter.ValidateNotAllowed(embeddedJsonSource.ScriptSelector, "EmbeddedJsonSource.ScriptSelector");
        }

        return null;
    }

    // Exactly one of the flat ItemsPath + Fields shape or the Groups tree.
    private static string? ValidateApiResponseShape(ApiConfig api)
    {
        var hasFlat = api.ItemsPath is not null || api.Fields is not null;
        var hasGroups = api.Groups is { Count: > 0 };

        if (hasFlat && hasGroups)
            return "ItemsPath/Fields and Groups are mutually exclusive.";
        if (!hasFlat && !hasGroups)
            return "Api configuration needs either ItemsPath and Fields, or Groups.";

        if (hasFlat)
            return ValidateApiFlatFields(api);

        var treeError = ValidateApiNodes(api.Groups!);
        if (treeError is not null)
            return treeError;

        return ApiNodesContainField(api.Groups!) ? null : "Api configuration (Groups) must contain at least one field.";
    }

    private static string? ValidateApiFlatFields(ApiConfig api)
    {
        if (api.ItemsPath is null || api.Fields is null)
            return "ItemsPath and Fields must both be set if either one is set.";

        if (string.IsNullOrWhiteSpace(api.ItemsPath))
            return "ItemsPath must not be empty.";

        if (api.Fields.Count == 0)
            return "Api configuration must contain at least one field.";

        var precedingFieldNames = new List<string>();
        foreach (var field in api.Fields)
        {
            if (string.IsNullOrWhiteSpace(field.Name))
                return "Field name must not be empty.";
            if (string.IsNullOrWhiteSpace(field.Path) && !IsDerivedField(field.Transforms))
                return $"Path for field '{field.Name}' must not be empty.";
            var transformError = FieldTransformValidator.Validate(field.Transforms, $"field '{field.Name}'")
                ?? ValidateFieldTransformOrdering(field.Transforms, field.Name, precedingFieldNames, $"field '{field.Name}'");
            if (transformError is not null)
                return transformError;
            precedingFieldNames.Add(field.Name);
        }

        var duplicateFieldNames = FindDuplicates(api.Fields, field => field.Name);
        if (duplicateFieldNames.Count > 0)
            return $"Duplicate field names: {string.Join(", ", duplicateFieldNames)}.";

        // Parameter values become extra CSV columns, so a shared name would silently merge two columns. Only the flat
        // shape: in the XML tree shape duplicate sibling names are fine.
        var collidingNames = api.Fields.Select(field => field.Name)
            .Intersect(api.Parameters.Select(parameter => parameter.Name))
            .ToList();
        return collidingNames.Count > 0
            ? $"Field name(s) collide with parameter names: {string.Join(", ", collidingNames)}."
            : null;
    }

    private static string? ValidateApiParameters(ApiConfig api, string? bootstrapName)
    {
        // Zero parameters is valid: a fully static endpoint.
        if (api.Parameters.Any(parameter => string.IsNullOrWhiteSpace(parameter.Name)))
            return "Parameter name must not be empty.";

        var duplicateParameterNames = FindDuplicates(api.Parameters, parameter => parameter.Name);
        if (duplicateParameterNames.Count > 0)
            return $"Duplicate parameter names: {string.Join(", ", duplicateParameterNames)}.";

        var placeholders = UrlTemplatePlaceholderPattern.Matches(api.UrlTemplate)
            .Select(match => match.Groups[1].Value)
            .ToHashSet();
        var parameterNames = api.Parameters.Select(parameter => parameter.Name).ToHashSet();

        // The bootstrap value is referenceable like a parameter placeholder without being one (ApiConfig.Bootstrap).
        if (api.Bootstrap is { } bootstrap)
        {
            var bootstrapError = ValidateApiBootstrap(bootstrap);
            if (bootstrapError is not null)
                return bootstrapError;
            if (parameterNames.Contains(bootstrap.Name))
                return $"Bootstrap value name '{bootstrap.Name}' collides with a parameter name.";
            if (api.Fields?.Any(field => field.Name == bootstrap.Name) == true)
                return $"Bootstrap value name '{bootstrap.Name}' collides with a field name.";
        }
        var placeholderNames = bootstrapName is null ? parameterNames : [.. parameterNames, bootstrapName];

        var missingParameters = placeholders.Except(placeholderNames).ToList();
        if (missingParameters.Count > 0)
            return $"UrlTemplate references unknown parameters: {string.Join(", ", missingParameters)}.";

        // A parameter is used if the URL template or the request body references it.
        var referencedByBody = new HashSet<string>();
        if (api.Body is not null)
        {
            var bodyError = ValidateApiBodyNode(api.Body, placeholderNames, referencedByBody);
            if (bodyError is not null)
                return bodyError;
        }

        var unusedParameters = parameterNames.Except(placeholders).Except(referencedByBody).ToList();
        if (unusedParameters.Count > 0)
            return $"Parameters with no placeholder in UrlTemplate: {string.Join(", ", unusedParameters)}.";

        return ValidateApiParameterSources(api, parameterNames, placeholders);
    }

    // A strict chain: a discovery template may reference only parameters declared before it, so declaration order is
    // checked incrementally together with each source kind.
    private static string? ValidateApiParameterSources(ApiConfig api, HashSet<string> parameterNames, HashSet<string> placeholders)
    {
        var declaredSoFar = new HashSet<string>();
        foreach (var parameter in api.Parameters)
        {
            var dependencyError = ValidateParameterDependencyOrder(parameter, declaredSoFar, parameterNames);
            if (dependencyError is not null)
                return dependencyError;

            var sourceError = parameter.Source switch
            {
                StaticListSource { Values.Count: 0 } =>
                    $"Parameter '{parameter.Name}' with a value list needs at least one value.",
                DiscoverySource discovery => ValidateDiscoverySource(parameter.Name, discovery),
                RangeSource range => ValidateRangeSource(parameter.Name, range),
                // Matched against this UrlTemplate at run time, so the parameter's own placeholder must occur in it.
                BrowserDiscoverySource when !placeholders.Contains(parameter.Name) =>
                    $"Parameter '{parameter.Name}' uses browser discovery but doesn't appear in UrlTemplate — there would be nothing to match captured requests against.",
                BrowserDiscoverySource browserDiscovery => ValidateBrowserDiscoverySource(parameter.Name, browserDiscovery),
                _ => null,
            };
            if (sourceError is not null)
                return sourceError;

            declaredSoFar.Add(parameter.Name);
        }

        return null;
    }

    private static string? ValidateApiHeaders(List<ApiHeader> headers, string? bootstrapName)
    {
        foreach (var header in headers)
        {
            if (string.IsNullOrWhiteSpace(header.Name))
                return "Name of an Api header must not be empty.";

            var hasValue = !string.IsNullOrWhiteSpace(header.Value);
            var hasEnvironmentVariable = !string.IsNullOrWhiteSpace(header.EnvironmentVariableName);
            var hasTemplate = !string.IsNullOrWhiteSpace(header.Template);
            if ((hasValue ? 1 : 0) + (hasEnvironmentVariable ? 1 : 0) + (hasTemplate ? 1 : 0) != 1)
                return $"Header '{header.Name}' needs exactly one of Value/EnvironmentVariableName/Template.";

            // Issue #220: a Template's only purpose is splicing in the
            // bootstrap value, so it must reference it, and nothing else —
            // there's no per-combination parameter context when headers are
            // built (they're shared by every request of the run).
            if (hasTemplate)
            {
                if (bootstrapName is null)
                    return $"Header '{header.Name}' uses a template, but no bootstrap request is configured.";
                var referenced = UrlTemplatePlaceholderPattern.Matches(header.Template!).Select(match => match.Groups[1].Value).ToHashSet();
                if (!referenced.Contains(bootstrapName))
                    return $"Header '{header.Name}' template must reference the bootstrap value '{{{bootstrapName}}}'.";
                var unknown = referenced.Where(name => name != bootstrapName).ToList();
                if (unknown.Count > 0)
                    return $"Header '{header.Name}' template references unknown placeholder(s): {string.Join(", ", unknown)}.";
            }

            if (hasEnvironmentVariable && !EnvironmentVariableNamePattern.IsMatch(header.EnvironmentVariableName!))
                return $"Invalid environment variable name '{header.EnvironmentVariableName}' in header '{header.Name}'.";
        }

        // _build_headers() in scraper_api.py.j2 builds a dict keyed by name —
        // a duplicate would silently overwrite an earlier header instead of
        // surfacing as an error.
        var duplicateHeaderNames = FindDuplicates(headers, header => header.Name);
        if (duplicateHeaderNames.Count > 0)
            return $"Duplicate header names: {string.Join(", ", duplicateHeaderNames)}.";

        return null;
    }
}
