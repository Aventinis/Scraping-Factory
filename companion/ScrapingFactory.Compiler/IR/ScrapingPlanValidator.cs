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

        if (navigate.Urls.Count == 0)
            return Invalid("NavigateStep muss mindestens eine URL enthalten.");

        for (var i = 0; i < navigate.Urls.Count; i++)
        {
            var url = navigate.Urls[i];
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
                (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            {
                return Invalid($"Ungültige Start-URL #{i + 1} '{url}': muss eine absolute http(s)-URL sein.");
            }
        }

        // Issue #87: mode-independent (Fields/Groups/Api alike), so this
        // runs before the mode-specific branches below, which each return
        // early.
        if (plan.ChangeDetection is { } changeDetection)
        {
            var changeDetectionError = ValidateChangeDetection(changeDetection);
            if (changeDetectionError is not null)
                return Invalid(changeDetectionError);
        }

        // Issue #88: mode-independent (Fields/Groups/Api alike), same
        // "before the mode-specific branches" placement as ChangeDetection.
        if (plan.Proxy is { } proxy)
        {
            var proxyError = ValidateProxy(proxy);
            if (proxyError is not null)
                return Invalid(proxyError);
        }

        // Issue #129: mode-independent, same placement as ChangeDetection/
        // Proxy above.
        if (plan.Hardening is { Count: > 0 } hardening)
        {
            var hardeningError = ValidateHardening(hardening);
            if (hardeningError is not null)
                return Invalid(hardeningError);
        }

        // WaitFor/Fill/Click/Scroll all need a real browser to mean anything —
        // the Static engine's codegen simply doesn't look at them, so
        // silently generating a script that just drops them would be
        // confusing.
        var browserOnlySteps = plan.Steps.Where(step => step is WaitForStep or FillStep or ClickStep or ScrollStep).ToList();
        if (plan.Engine != ScrapingEngine.Browser && browserOnlySteps.Count > 0)
            return Invalid("WaitForStep/FillStep/ClickStep/ScrollStep erfordern Engine 'Browser'.");

        foreach (var waitStep in plan.Steps.OfType<WaitForStep>())
        {
            if (string.IsNullOrWhiteSpace(waitStep.Selector))
                return Invalid("Selector eines WaitForStep darf nicht leer sein.");
            if (waitStep.TimeoutMs <= 0)
                return Invalid("Timeout eines WaitForStep muss positiv sein.");
            var waitFrameError = ValidateFramePath(waitStep.FramePath, "WaitForStep", plan.Engine);
            if (waitFrameError is not null)
                return Invalid(waitFrameError);
        }

        foreach (var fillStep in plan.Steps.OfType<FillStep>())
        {
            if (string.IsNullOrWhiteSpace(fillStep.Selector))
                return Invalid("Selector eines FillStep darf nicht leer sein.");
            if (!EnvironmentVariableNamePattern.IsMatch(fillStep.EnvironmentVariableName))
                return Invalid($"Ungültiger Umgebungsvariablen-Name '{fillStep.EnvironmentVariableName}' in FillStep.");
            var fillFrameError = ValidateFramePath(fillStep.FramePath, "FillStep", plan.Engine);
            if (fillFrameError is not null)
                return Invalid(fillFrameError);
        }

        foreach (var clickStep in plan.Steps.OfType<ClickStep>())
        {
            if (string.IsNullOrWhiteSpace(clickStep.Selector))
                return Invalid("Selector eines ClickStep darf nicht leer sein.");
            var clickFrameError = ValidateFramePath(clickStep.FramePath, "ClickStep", plan.Engine);
            if (clickFrameError is not null)
                return Invalid(clickFrameError);
        }

        foreach (var scrollStep in plan.Steps.OfType<ScrollStep>())
        {
            if (scrollStep.ContainerSelector is not null && string.IsNullOrWhiteSpace(scrollStep.ContainerSelector))
                return Invalid("ContainerSelector eines ScrollStep darf, wenn gesetzt, nicht leer sein.");
            if (scrollStep.LoadMoreButtonSelector is not null && string.IsNullOrWhiteSpace(scrollStep.LoadMoreButtonSelector))
                return Invalid("LoadMoreButtonSelector eines ScrollStep darf, wenn gesetzt, nicht leer sein.");
            if (scrollStep.MaxIterations <= 0)
                return Invalid("MaxIterations eines ScrollStep muss positiv sein.");
            if (scrollStep.WaitAfterMs < 0)
                return Invalid("WaitAfterMs eines ScrollStep darf nicht negativ sein.");
            var scrollFrameError = ValidateFramePath(scrollStep.FramePath, "ScrollStep", plan.Engine);
            if (scrollFrameError is not null)
                return Invalid(scrollFrameError);
        }

        // Container-Mode replaces the flat ExtractStep list wholesale — see
        // ScrapingPlanBuilder. Engine-independent, so deliberately not part
        // of browserOnlySteps above.
        var extractGroupStep = plan.Steps.OfType<ExtractGroupStep>().SingleOrDefault();
        if (extractGroupStep is not null)
        {
            if (extractGroupStep.Roots.Count == 0)
                return Invalid("ExtractGroupStep muss mindestens eine Gruppe enthalten.");

            var groupError = ValidateContainerNodes(extractGroupStep.Roots, plan.Engine);
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

            // FramePath is Browser-engine-only, unlike ExtractStep itself
            // (used by both engines) — so this can't join browserOnlySteps
            // above, which gates on step *type*, not a per-step property.
            var frameError = ValidateFramePath(step.FramePath, $"Feld '{step.Name}'", plan.Engine);
            if (frameError is not null)
                return Invalid(frameError);

            var transformError = FieldTransformValidator.Validate(step.Transforms, $"Feld '{step.Name}'");
            if (transformError is not null)
                return Invalid(transformError);
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
    private static string? ValidateContainerNodes(IEnumerable<ContainerNode> nodes, ScrapingEngine engine)
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
                    var groupFrameError = ValidateFramePath(group.FramePath, $"Gruppe '{group.Name}'", engine);
                    if (groupFrameError is not null)
                        return groupFrameError;
                    var childError = ValidateContainerNodes(group.Children, engine);
                    if (childError is not null)
                        return childError;
                    break;

                case DataFieldNode field:
                    if (string.IsNullOrWhiteSpace(field.Selector))
                        return $"Selector des Datenfelds '{field.Name}' darf nicht leer sein.";
                    if (field.Mode == ExtractMode.Attribute && string.IsNullOrWhiteSpace(field.Attribute))
                        return $"Datenfeld '{field.Name}' mit Modus 'Attribute' braucht ein Attribut.";
                    var fieldFrameError = ValidateFramePath(field.FramePath, $"Datenfeld '{field.Name}'", engine);
                    if (fieldFrameError is not null)
                        return fieldFrameError;
                    var fieldTransformError = FieldTransformValidator.Validate(field.Transforms, $"Datenfeld '{field.Name}'");
                    if (fieldTransformError is not null)
                        return fieldTransformError;
                    break;
            }
        }
        return null;
    }

    // Mirrors ValidateContainerNodes for API-Mode's JSON-path tree (Issue
    // #54): same non-empty-name rule and recursive walk. Path itself stays
    // deliberately unvalidated (see ValidateApiConfig's doc comment) except
    // ApiField.Path, which — unlike ApiGroup.Path — must be non-empty: an
    // empty ApiGroup.Path is a legitimate "operate directly on the parent
    // scope" marker (see ApiGroup's doc comment), but an empty ApiField.Path
    // would silently extract nothing.
    private static string? ValidateApiNodes(IEnumerable<ApiNode> nodes)
    {
        foreach (var node in nodes)
        {
            if (string.IsNullOrWhiteSpace(node.Name))
                return "Name eines Api-Knotens darf nicht leer sein.";

            switch (node)
            {
                case ApiGroup group:
                    if (group.Children.Count == 0)
                        return $"Gruppe '{group.Name}' braucht mindestens ein Kind-Element.";
                    var childError = ValidateApiNodes(group.Children);
                    if (childError is not null)
                        return childError;
                    break;

                case ApiField field:
                    if (string.IsNullOrWhiteSpace(field.Path))
                        return $"Pfad des Felds '{field.Name}' darf nicht leer sein.";
                    var apiFieldTransformError = FieldTransformValidator.Validate(field.Transforms, $"Feld '{field.Name}'");
                    if (apiFieldTransformError is not null)
                        return apiFieldTransformError;
                    break;
            }
        }
        return null;
    }

    // A tree of only nested, empty-of-fields groups would extract nothing —
    // mirrors the flat shape's "Fields.Count == 0 → error" check above, just
    // walked recursively since a field could be reachable at any depth.
    private static bool ApiNodesContainField(IEnumerable<ApiNode> nodes) =>
        nodes.Any(node => node switch
        {
            ApiField => true,
            ApiGroup group => ApiNodesContainField(group.Children),
            _ => false,
        });

    // Request-body tree (Issue #55): the write-side mirror of
    // ValidateApiNodes above. Object/Array just recurse; a Variable must
    // reference a declared parameter (collected into referencedParameterNames
    // so the caller can fold body references into its own UrlTemplate
    // "unused parameter" check); a Literal's Kind must agree with which
    // value field is actually set — Kind itself isn't inferred structurally
    // (see ApiBodyLiteral's doc comment), so a mismatch here would otherwise
    // only surface as a silently-wrong value in the generated request body.
    private static string? ValidateApiBodyNode(ApiBodyNode node, HashSet<string> parameterNames, HashSet<string> referencedParameterNames)
    {
        switch (node)
        {
            case ApiBodyObject obj:
                foreach (var (key, child) in obj.Properties)
                {
                    if (string.IsNullOrWhiteSpace(key))
                        return "Property-Name im Body darf nicht leer sein.";
                    var propertyError = ValidateApiBodyNode(child, parameterNames, referencedParameterNames);
                    if (propertyError is not null)
                        return propertyError;
                }
                return null;

            case ApiBodyArray array:
                foreach (var item in array.Items)
                {
                    var itemError = ValidateApiBodyNode(item, parameterNames, referencedParameterNames);
                    if (itemError is not null)
                        return itemError;
                }
                return null;

            case ApiBodyVariable variable:
                if (!parameterNames.Contains(variable.ParameterName))
                    return $"Body referenziert unbekannten Parameter '{variable.ParameterName}'.";
                referencedParameterNames.Add(variable.ParameterName);
                return null;

            case ApiBodyLiteral literal:
                return literal.Kind switch
                {
                    ApiBodyLiteralKind.String when literal.StringValue is null =>
                        "Body-Literal vom Typ 'String' braucht StringValue.",
                    ApiBodyLiteralKind.Number when literal.NumberValue is null =>
                        "Body-Literal vom Typ 'Number' braucht NumberValue.",
                    ApiBodyLiteralKind.Boolean when literal.BoolValue is null =>
                        "Body-Literal vom Typ 'Boolean' braucht BoolValue.",
                    ApiBodyLiteralKind.Null when literal.StringValue is not null || literal.NumberValue is not null || literal.BoolValue is not null =>
                        "Body-Literal vom Typ 'Null' darf keinen Wert gesetzt haben.",
                    _ => null,
                };

            default:
                throw new NotSupportedException($"Unbekannter ApiBodyNode-Typ: {node.GetType()}");
        }
    }

    // Shared by ExtractStep.FramePath and GroupNode/DataFieldNode.FramePath
    // (Issue #42) — same three checks regardless of which node type carries
    // the FramePath.
    private static string? ValidateFramePath(List<string>? framePath, string context, ScrapingEngine engine)
    {
        if (framePath is null)
            return null;
        if (engine != ScrapingEngine.Browser)
            return $"FramePath für {context} erfordert Engine 'Browser'.";
        if (framePath.Count == 0)
            return $"FramePath für {context} darf, wenn gesetzt, nicht leer sein.";
        if (framePath.Any(string.IsNullOrWhiteSpace))
            return $"FramePath für {context} darf keine leeren Segmente enthalten.";
        return null;
    }

    private static readonly Regex UrlTemplatePlaceholderPattern = new(@"\{([^{}]+)\}");

    // Deliberately doesn't validate JSON-path syntax (ItemsPath/Fields[].Path/
    // ApiGroup.Path/DiscoverySource.ValuePath) — same laissez-faire as CSS
    // selectors and XML tag names elsewhere in this validator: a bad path
    // surfaces as a real runtime miss via PythonScriptVerifier, not here.
    private static string? ValidateApiConfig(ApiConfig api)
    {
        if (api.Method is not ("GET" or "POST"))
            return $"Nicht unterstützte HTTP-Methode '{api.Method}': Api-Mode unterstützt bisher nur GET und POST.";

        // Body (Issue #55) requires Method == "POST" — a bodyless POST is
        // still valid, a GET with a Body makes no sense and is rejected
        // here rather than silently ignored.
        if (api.Body is not null && api.Method != "POST")
            return "Body erfordert Methode 'POST'.";

        // Two mutually exclusive response shapes (Issue #54): the original
        // flat ItemsPath+Fields (exactly one repetition level), or the
        // recursive Groups tree (arbitrarily deep). Exactly one of the two
        // must be set.
        var hasFlat = api.ItemsPath is not null || api.Fields is not null;
        var hasGroups = api.Groups is { Count: > 0 };

        if (hasFlat && hasGroups)
            return "ItemsPath/Fields und Groups schließen sich gegenseitig aus.";
        if (!hasFlat && !hasGroups)
            return "Api-Konfiguration braucht entweder ItemsPath und Fields, oder Groups.";

        if (hasFlat)
        {
            if (api.ItemsPath is null || api.Fields is null)
                return "ItemsPath und Fields müssen beide gesetzt sein, wenn eines von beiden gesetzt ist.";

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
                var transformError = FieldTransformValidator.Validate(field.Transforms, $"Feld '{field.Name}'");
                if (transformError is not null)
                    return transformError;
            }

            var duplicateFieldNames = FindDuplicates(api.Fields, field => field.Name);
            if (duplicateFieldNames.Count > 0)
                return $"Doppelte Feldnamen: {string.Join(", ", duplicateFieldNames)}.";

            // Parameter values become extra CSV columns alongside the
            // extracted fields (see PythonApiCodeGenerator) — a name shared
            // between the two would silently collapse two distinct columns
            // into one. Only meaningful for the flat/Csv shape — the tree
            // shape outputs Xml, where duplicate sibling names are exactly
            // as fine as they already are in Container-Mode, so this check
            // is deliberately not ported to ValidateApiNodes below.
            var collidingNames = api.Fields.Select(field => field.Name)
                .Intersect(api.Parameters.Select(parameter => parameter.Name))
                .ToList();
            if (collidingNames.Count > 0)
                return $"Feldname(n) kollidieren mit Parameternamen: {string.Join(", ", collidingNames)}.";
        }
        else
        {
            var treeError = ValidateApiNodes(api.Groups!);
            if (treeError is not null)
                return treeError;

            if (!ApiNodesContainField(api.Groups!))
                return "Api-Konfiguration (Groups) muss mindestens ein Feld enthalten.";
        }

        // Zero parameters is a valid, fully static endpoint (every URL part
        // fixed, no enumeration) — the checks below (duplicate names,
        // UrlTemplate placeholder matching, ...) already degrade correctly
        // to no-ops on an empty list, and the generated script's
        // itertools.product(*value_lists) over zero lists yields exactly one
        // (parameterless) call, so no code-generation change was needed.
        foreach (var parameter in api.Parameters)
        {
            if (string.IsNullOrWhiteSpace(parameter.Name))
                return "Parametername darf nicht leer sein.";
        }

        var duplicateParameterNames = FindDuplicates(api.Parameters, parameter => parameter.Name);
        if (duplicateParameterNames.Count > 0)
            return $"Doppelte Parameternamen: {string.Join(", ", duplicateParameterNames)}.";

        var placeholders = UrlTemplatePlaceholderPattern.Matches(api.UrlTemplate)
            .Select(match => match.Groups[1].Value)
            .ToHashSet();
        var parameterNames = api.Parameters.Select(parameter => parameter.Name).ToHashSet();

        var missingParameters = placeholders.Except(parameterNames).ToList();
        if (missingParameters.Count > 0)
            return $"UrlTemplate referenziert unbekannte Parameter: {string.Join(", ", missingParameters)}.";

        // A declared parameter can now be referenced from either the
        // UrlTemplate (checked above) or the request body (Issue #55) — only
        // a parameter referenced by neither is truly unused. The body's own
        // "unknown parameter" half gets its own distinct error message
        // below, mirroring missingParameters' UrlTemplate-side check.
        var referencedByBody = new HashSet<string>();
        if (api.Body is not null)
        {
            var bodyError = ValidateApiBodyNode(api.Body, parameterNames, referencedByBody);
            if (bodyError is not null)
                return bodyError;
        }

        var unusedParameters = parameterNames.Except(placeholders).Except(referencedByBody).ToList();
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

    // Issue #87: every field here is an env var *name* (like
    // FillAction.EnvironmentVariableName), never a literal value — same
    // EnvironmentVariableNamePattern check as everywhere else that's true.
    private static string? ValidateChangeDetection(ChangeDetectionConfig changeDetection)
    {
        if (changeDetection.Notify is not ("Email" or "Webhook"))
            return $"Nicht unterstützte Notify-Methode '{changeDetection.Notify}': erwartet 'Email' oder 'Webhook'.";

        if (changeDetection.Notify == "Email")
        {
            if (changeDetection.Email is null)
                return "ChangeDetection mit Notify 'Email' braucht eine Email-Konfiguration.";
            if (changeDetection.Webhook is not null)
                return "ChangeDetection darf nicht sowohl Email als auch Webhook konfigurieren.";

            var email = changeDetection.Email;
            var requiredNames = new (string Value, string Field)[]
            {
                (email.SmtpHostEnvVar, "SmtpHostEnvVar"), (email.FromEnvVar, "FromEnvVar"), (email.ToEnvVar, "ToEnvVar"),
            };
            foreach (var (value, field) in requiredNames)
            {
                if (!EnvironmentVariableNamePattern.IsMatch(value))
                    return $"Ungültiger Umgebungsvariablen-Name '{value}' in ChangeDetection.Email.{field}.";
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
                    return $"Ungültiger Umgebungsvariablen-Name '{value}' in ChangeDetection.Email.{field}.";
            }

            return null;
        }

        if (changeDetection.Webhook is null)
            return "ChangeDetection mit Notify 'Webhook' braucht eine Webhook-Konfiguration.";

        return EnvironmentVariableNamePattern.IsMatch(changeDetection.Webhook.UrlEnvVar)
            ? null
            : $"Ungültiger Umgebungsvariablen-Name '{changeDetection.Webhook.UrlEnvVar}' in ChangeDetection.Webhook.UrlEnvVar.";
    }

    // Issue #88: only the env var *name* is validated here — the companion
    // never sees the actual proxy URLs (same boundary as FillAction/
    // ChangeDetection credentials).
    private static string? ValidateProxy(ProxyConfig proxy) =>
        EnvironmentVariableNamePattern.IsMatch(proxy.EnvironmentVariableName)
            ? null
            : $"Ungültiger Umgebungsvariablen-Name '{proxy.EnvironmentVariableName}' in Proxy.EnvironmentVariableName.";

    // Issue #129: the only structural rule today — each check kind (the
    // concrete HardeningCheck subtype, since there's no separate string
    // "Kind" property to compare on the C# side; that string only exists on
    // the wire/in the generated script) may appear at most once. Nothing
    // else to validate: Severity is a required enum (an invalid string
    // already fails deserialization before this ever runs), and
    // NoResultCheck — the only kind implemented so far — has no parameters
    // of its own.
    private static string? ValidateHardening(List<HardeningCheck> hardening)
    {
        var duplicateKind = hardening
            .GroupBy(check => check.GetType())
            .FirstOrDefault(group => group.Count() > 1)
            ?.Key.Name;
        return duplicateKind is null ? null : $"Hardening-Check '{duplicateKind}' ist mehrfach konfiguriert.";
    }
}
