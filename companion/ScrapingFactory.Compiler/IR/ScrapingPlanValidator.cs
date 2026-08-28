using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.Backends.Python;

namespace ScrapingFactory.Compiler.IR;

// Fast, in-process structural checks on a ScrapingPlan, run before codegen
// and (much more expensively) real script execution — rejects configs that
// are wrong no matter how the generated script behaves (malformed URL,
// duplicate/empty field names) without paying for a subprocess spawn and a
// real network request.
//
// Deliberately does NOT validate CSS selector syntax or compatibility with
// BeautifulSoup/soupsieve — that's a known, accepted limitation of the
// chosen approach (see CLAUDE.md "Selektor-Kompatibilität") and is only
// ever proven by PythonScriptVerifier actually running the script.
public static class ScrapingPlanValidator
{
    public static PlanValidationResult Validate(ScrapingPlan plan)
    {
        if (plan.Steps.Count == 0 || plan.Steps[0] is not NavigateStep navigate)
            return Invalid("Plan muss mit einem NavigateStep beginnen.");

        if (plan.Steps.Skip(1).Any(step => step is NavigateStep))
            return Invalid("Plan darf nur einen NavigateStep enthalten.");

        if (!Uri.TryCreate(navigate.Url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            return Invalid($"Ungültige URL '{navigate.Url}': muss eine absolute http(s)-URL sein.");
        }

        // WaitFor/Fill/Click all need a real browser to mean anything — the
        // Static engine's codegen simply doesn't look at them, so silently
        // generating a script that just drops them would be confusing.
        var browserOnlySteps = plan.Steps.Where(step => step is WaitForStep or FillStep or ClickStep).ToList();
        if (plan.Engine != ScrapingEngine.Browser && browserOnlySteps.Count > 0)
            return Invalid("WaitForStep/FillStep/ClickStep erfordern Engine 'Browser'.");

        foreach (var waitStep in plan.Steps.OfType<WaitForStep>())
        {
            if (string.IsNullOrWhiteSpace(waitStep.Selector))
                return Invalid("Selector eines WaitForStep darf nicht leer sein.");
            if (waitStep.TimeoutMs <= 0)
                return Invalid("Timeout eines WaitForStep muss positiv sein.");
        }

        foreach (var fillStep in plan.Steps.OfType<FillStep>())
        {
            if (string.IsNullOrWhiteSpace(fillStep.Selector))
                return Invalid("Selector eines FillStep darf nicht leer sein.");
            if (!EnvironmentVariableNamePattern.IsMatch(fillStep.EnvironmentVariableName))
                return Invalid($"Ungültiger Umgebungsvariablen-Name '{fillStep.EnvironmentVariableName}' in FillStep.");
        }

        foreach (var clickStep in plan.Steps.OfType<ClickStep>())
        {
            if (string.IsNullOrWhiteSpace(clickStep.Selector))
                return Invalid("Selector eines ClickStep darf nicht leer sein.");
        }

        // Container-Mode replaces the flat ExtractStep list wholesale — see
        // ScrapingPlanBuilder. Engine-independent, so deliberately not part
        // of browserOnlySteps above.
        var extractGroupStep = plan.Steps.OfType<ExtractGroupStep>().SingleOrDefault();
        if (extractGroupStep is not null)
        {
            if (extractGroupStep.Roots.Count == 0)
                return Invalid("ExtractGroupStep muss mindestens eine Gruppe enthalten.");

            var groupError = ValidateContainerNodes(extractGroupStep.Roots);
            return groupError is null ? new PlanValidationResult { Success = true } : Invalid(groupError);
        }

        // API-Mode replaces the flat ExtractStep list wholesale, just like
        // Container-Mode above — see ScrapingPlanBuilder.
        var apiCallStep = plan.Steps.OfType<ApiCallStep>().SingleOrDefault();
        if (apiCallStep is not null)
        {
            var apiError = ValidateApiConfig(apiCallStep.Config);
            return apiError is null ? new PlanValidationResult { Success = true } : Invalid(apiError);
        }

        var extractSteps = plan.Steps.OfType<ExtractStep>().ToList();
        if (extractSteps.Count == 0)
            return Invalid("Plan muss mindestens einen ExtractStep enthalten.");

        foreach (var step in extractSteps)
        {
            if (string.IsNullOrWhiteSpace(step.Name))
                return Invalid("Feldname darf nicht leer sein.");
            if (string.IsNullOrWhiteSpace(step.Selector))
                return Invalid($"Selector für Feld '{step.Name}' darf nicht leer sein.");
        }

        var duplicateNames = FindDuplicates(extractSteps, step => step.Name);
        if (duplicateNames.Count > 0)
            return Invalid($"Doppelte Feldnamen: {string.Join(", ", duplicateNames)}.");

        return new PlanValidationResult { Success = true };
    }

    private static readonly Regex EnvironmentVariableNamePattern = new("^[A-Za-z_][A-Za-z0-9_]*$");

    private static PlanValidationResult Invalid(string error) => new() { Success = false, Error = error };

    private static List<string> FindDuplicates<T>(IEnumerable<T> items, Func<T, string> keySelector) =>
        items.GroupBy(keySelector).Where(group => group.Count() > 1).Select(group => group.Key).ToList();

    // Deliberately doesn't check whether Name is a valid XML tag name, or
    // whether a non-repeating GroupNode's selector could ever match more
    // than once — same laissez-faire as CSS selector syntax elsewhere in
    // this validator (see class doc comment): a bad tag name surfaces as a
    // real Python exception via PythonScriptVerifier, not here.
    private static string? ValidateContainerNodes(IEnumerable<ContainerNode> nodes)
    {
        foreach (var node in nodes)
        {
            if (string.IsNullOrWhiteSpace(node.Name))
                return "Name eines Container-Knotens darf nicht leer sein.";

            switch (node)
            {
                case GroupNode group:
                    if (string.IsNullOrWhiteSpace(group.Selector))
                        return $"Selector der Gruppe '{group.Name}' darf nicht leer sein.";
                    var childError = ValidateContainerNodes(group.Children);
                    if (childError is not null)
                        return childError;
                    break;

                case DataFieldNode field:
                    if (string.IsNullOrWhiteSpace(field.Selector))
                        return $"Selector des Datenfelds '{field.Name}' darf nicht leer sein.";
                    if (field.Mode == ExtractMode.Attribute && string.IsNullOrWhiteSpace(field.Attribute))
                        return $"Datenfeld '{field.Name}' mit Modus 'Attribute' braucht ein Attribut.";
                    break;
            }
        }
        return null;
    }

    private static readonly Regex UrlTemplatePlaceholderPattern = new(@"\{([^{}]+)\}");

    // Deliberately doesn't validate JSON-path syntax (ItemsPath/Fields[].Path/
    // DiscoverySource.ValuePath) — same laissez-faire as CSS selectors and
    // XML tag names elsewhere in this validator: a bad path surfaces as a
    // real runtime miss via PythonScriptVerifier once Phase 2 adds codegen,
    // not here.
    private static string? ValidateApiConfig(ApiConfig api)
    {
        if (api.Method != "GET")
            return $"Nicht unterstützte HTTP-Methode '{api.Method}': Api-Mode unterstützt bisher nur GET.";

        if (string.IsNullOrWhiteSpace(api.ItemsPath))
            return "ItemsPath darf nicht leer sein.";

        if (api.Fields.Count == 0)
            return "Api-Konfiguration muss mindestens ein Feld enthalten.";

        foreach (var field in api.Fields)
        {
            if (string.IsNullOrWhiteSpace(field.Name))
                return "Feldname darf nicht leer sein.";
            if (string.IsNullOrWhiteSpace(field.Path))
                return $"Pfad für Feld '{field.Name}' darf nicht leer sein.";
        }

        var duplicateFieldNames = FindDuplicates(api.Fields, field => field.Name);
        if (duplicateFieldNames.Count > 0)
            return $"Doppelte Feldnamen: {string.Join(", ", duplicateFieldNames)}.";

        if (api.Parameters.Count == 0)
            return "Api-Konfiguration muss mindestens einen Parameter enthalten.";

        foreach (var parameter in api.Parameters)
        {
            if (string.IsNullOrWhiteSpace(parameter.Name))
                return "Parametername darf nicht leer sein.";
        }

        var duplicateParameterNames = FindDuplicates(api.Parameters, parameter => parameter.Name);
        if (duplicateParameterNames.Count > 0)
            return $"Doppelte Parameternamen: {string.Join(", ", duplicateParameterNames)}.";

        // Parameter values become extra CSV columns alongside the extracted
        // fields (see PythonApiCodeGenerator) — a name shared between the
        // two would silently collapse two distinct columns into one.
        var collidingNames = api.Fields.Select(field => field.Name)
            .Intersect(api.Parameters.Select(parameter => parameter.Name))
            .ToList();
        if (collidingNames.Count > 0)
            return $"Feldname(n) kollidieren mit Parameternamen: {string.Join(", ", collidingNames)}.";

        var placeholders = UrlTemplatePlaceholderPattern.Matches(api.UrlTemplate)
            .Select(match => match.Groups[1].Value)
            .ToHashSet();
        var parameterNames = api.Parameters.Select(parameter => parameter.Name).ToHashSet();

        var missingParameters = placeholders.Except(parameterNames).ToList();
        if (missingParameters.Count > 0)
            return $"UrlTemplate referenziert unbekannte Parameter: {string.Join(", ", missingParameters)}.";

        var unusedParameters = parameterNames.Except(placeholders).ToList();
        if (unusedParameters.Count > 0)
            return $"Parameter ohne Platzhalter im UrlTemplate: {string.Join(", ", unusedParameters)}.";

        foreach (var parameter in api.Parameters)
        {
            var sourceError = parameter.Source switch
            {
                StaticListSource { Values.Count: 0 } =>
                    $"Parameter '{parameter.Name}' mit Werteliste braucht mindestens einen Wert.",
                DiscoverySource discovery => ValidateDiscoverySource(parameter.Name, discovery),
                RangeSource range => ValidateRangeSource(parameter.Name, range),
                _ => null,
            };
            if (sourceError is not null)
                return sourceError;
        }

        return api.Headers is { } headers ? ValidateApiHeaders(headers) : null;
    }

    // DiscoverySource.UrlTemplate is deliberately not cross-checked against
    // api.Parameters the way the main UrlTemplate is: Phase 1 explicitly
    // rules out dependencies between parameters (see issue #53's scope
    // boundaries), so a discovery endpoint's own template is expected to be
    // fully static.
    private static string? ValidateDiscoverySource(string parameterName, DiscoverySource discovery)
    {
        if (discovery.Method != "GET")
            return $"Discovery-Endpunkt für Parameter '{parameterName}': Api-Mode unterstützt bisher nur GET.";
        if (string.IsNullOrWhiteSpace(discovery.UrlTemplate))
            return $"Discovery-Endpunkt für Parameter '{parameterName}' braucht ein UrlTemplate.";
        if (string.IsNullOrWhiteSpace(discovery.ItemsPath))
            return $"Discovery-Endpunkt für Parameter '{parameterName}' braucht ein ItemsPath.";
        if (string.IsNullOrWhiteSpace(discovery.ValuePath))
            return $"Discovery-Endpunkt für Parameter '{parameterName}' braucht ein ValuePath.";
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
            return $"Bereich für Parameter '{parameterName}' braucht Start und Ende.";

        if (range.Type == RangeType.Number)
        {
            if (!int.TryParse(range.From, out _))
                return $"Start-Wert '{range.From}' für Parameter '{parameterName}' ist keine ganze Zahl.";
            if (!int.TryParse(range.To, out _))
                return $"Ende-Wert '{range.To}' für Parameter '{parameterName}' ist keine ganze Zahl.";
            return null;
        }

        var formatError = RangeFormat.ValidateFormat(range.Type, range.Format);
        if (formatError is not null)
            return $"Format für Parameter '{parameterName}': {formatError}";

        var format = RangeFormat.Resolve(range.Type, range.Format);
        // See RangeFormat.IsValid's doc comment for why allowToday differs
        // between From and To here.
        if (!RangeFormat.IsValid(range.From, format, allowToday: range.Type == RangeType.IsoWeek))
            return $"Start-Wert '{range.From}' für Parameter '{parameterName}' passt nicht zum Format '{format}'.";
        if (!RangeFormat.IsValid(range.To, format, allowToday: true))
            return $"Ende-Wert '{range.To}' für Parameter '{parameterName}' passt nicht zum Format '{format}'.";

        return null;
    }

    private static string? ValidateApiHeaders(List<ApiHeader> headers)
    {
        foreach (var header in headers)
        {
            if (string.IsNullOrWhiteSpace(header.Name))
                return "Name eines Api-Headers darf nicht leer sein.";

            var hasValue = !string.IsNullOrWhiteSpace(header.Value);
            var hasEnvironmentVariable = !string.IsNullOrWhiteSpace(header.EnvironmentVariableName);
            if (hasValue == hasEnvironmentVariable)
                return $"Header '{header.Name}' braucht genau eines von Value/EnvironmentVariableName.";

            if (hasEnvironmentVariable && !EnvironmentVariableNamePattern.IsMatch(header.EnvironmentVariableName!))
                return $"Ungültiger Umgebungsvariablen-Name '{header.EnvironmentVariableName}' in Header '{header.Name}'.";
        }

        // _build_headers() in scraper_api.py.j2 builds a dict keyed by name —
        // a duplicate would silently overwrite an earlier header instead of
        // surfacing as an error.
        var duplicateHeaderNames = FindDuplicates(headers, header => header.Name);
        if (duplicateHeaderNames.Count > 0)
            return $"Doppelte Header-Namen: {string.Join(", ", duplicateHeaderNames)}.";

        return null;
    }
}
