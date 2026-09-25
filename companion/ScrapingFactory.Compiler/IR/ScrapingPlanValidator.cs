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
// chosen approach (see CLAUDE.md "Selector compatibility") and is only
// ever proven by PythonScriptVerifier actually running the script.
public static class ScrapingPlanValidator
{
    public static PlanValidationResult Validate(ScrapingPlan plan)
    {
        if (plan.Steps.Count == 0 || plan.Steps[0] is not NavigateStep navigate)
            return Invalid("Plan must start with a NavigateStep.");

        if (plan.Steps.Skip(1).Any(step => step is NavigateStep))
            return Invalid("Plan must not contain more than one NavigateStep.");

        if (navigate.Urls.Count == 0)
            return Invalid("NavigateStep must contain at least one URL.");

        for (var i = 0; i < navigate.Urls.Count; i++)
        {
            var url = navigate.Urls[i];
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
                (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            {
                return Invalid($"Invalid start URL #{i + 1} '{url}': must be an absolute http(s) URL.");
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

        // Issue #174: mode-independent (Fields/Groups — ScrapingPlanBuilder
        // never sets this for an Api-mode plan), same placement as
        // ChangeDetection/Proxy/Hardening above.
        if (plan.Pagination is { } pagination)
        {
            var paginationError = ValidatePagination(pagination);
            if (paginationError is not null)
                return Invalid(paginationError);
        }

        // Issue #175: session persistence only means anything for the
        // Browser engine — a Static/Api-mode request has no browser session
        // to keep alive between runs. Same placement as ChangeDetection/
        // Proxy/Hardening/Pagination above, checked before the
        // browserOnlySteps gate below since PersistentSession is a
        // plan-level flag, not a step type.
        if (plan.PersistentSession && plan.Engine != ScrapingEngine.Browser)
            return Invalid("PersistentSession requires Engine 'Browser'.");

        // WaitFor/Fill/Click/Scroll all need a real browser to mean anything —
        // the Static engine's codegen simply doesn't look at them, so
        // silently generating a script that just drops them would be
        // confusing.
        var browserOnlySteps = plan.Steps.Where(step => step is WaitForStep or FillStep or ClickStep or ScrollStep).ToList();
        if (plan.Engine != ScrapingEngine.Browser && browserOnlySteps.Count > 0)
            return Invalid("WaitForStep/FillStep/ClickStep/ScrollStep require Engine 'Browser'.");

        foreach (var waitStep in plan.Steps.OfType<WaitForStep>())
        {
            if (string.IsNullOrWhiteSpace(waitStep.Selector))
                return Invalid("Selector of a WaitForStep must not be empty.");
            if (waitStep.TimeoutMs <= 0)
                return Invalid("Timeout of a WaitForStep must be positive.");
            var waitFrameError = ValidateFramePath(waitStep.FramePath, "WaitForStep", plan.Engine);
            if (waitFrameError is not null)
                return Invalid(waitFrameError);
        }

        foreach (var fillStep in plan.Steps.OfType<FillStep>())
        {
            if (string.IsNullOrWhiteSpace(fillStep.Selector))
                return Invalid("Selector of a FillStep must not be empty.");
            if (!EnvironmentVariableNamePattern.IsMatch(fillStep.EnvironmentVariableName))
                return Invalid($"Invalid environment variable name '{fillStep.EnvironmentVariableName}' in FillStep.");
            var fillFrameError = ValidateFramePath(fillStep.FramePath, "FillStep", plan.Engine);
            if (fillFrameError is not null)
                return Invalid(fillFrameError);
        }

        foreach (var clickStep in plan.Steps.OfType<ClickStep>())
        {
            if (string.IsNullOrWhiteSpace(clickStep.Selector))
                return Invalid("Selector of a ClickStep must not be empty.");
            var clickFrameError = ValidateFramePath(clickStep.FramePath, "ClickStep", plan.Engine);
            if (clickFrameError is not null)
                return Invalid(clickFrameError);
        }

        foreach (var scrollStep in plan.Steps.OfType<ScrollStep>())
        {
            if (scrollStep.ContainerSelector is not null && string.IsNullOrWhiteSpace(scrollStep.ContainerSelector))
                return Invalid("ContainerSelector of a ScrollStep must not be empty when set.");
            if (scrollStep.LoadMoreButtonSelector is not null && string.IsNullOrWhiteSpace(scrollStep.LoadMoreButtonSelector))
                return Invalid("LoadMoreButtonSelector of a ScrollStep must not be empty when set.");
            if (scrollStep.MaxIterations <= 0)
                return Invalid("MaxIterations of a ScrollStep must be positive.");
            if (scrollStep.WaitAfterMs < 0)
                return Invalid("WaitAfterMs of a ScrollStep must not be negative.");
            var scrollFrameError = ValidateFramePath(scrollStep.FramePath, "ScrollStep", plan.Engine);
            if (scrollFrameError is not null)
                return Invalid(scrollFrameError);
        }

        // Issue #182: Blocks replaces every other extraction shape wholesale
        // — see ScrapingPlanBuilder. Checked first among the four mutually
        // exclusive shapes purely for readability; construction already
        // guarantees at most one of these OfType<T>() lookups ever matches.
        var extractionBlockStep = plan.Steps.OfType<ExtractionBlockStep>().SingleOrDefault();
        if (extractionBlockStep is not null)
        {
            var blocksError = ValidateExtractionBlocks(extractionBlockStep.Blocks, plan.Engine);
            return blocksError is null ? new PlanValidationResult { Success = true } : Invalid(blocksError);
        }

        // Container-Mode replaces the flat ExtractStep list wholesale — see
        // ScrapingPlanBuilder. Engine-independent, so deliberately not part
        // of browserOnlySteps above.
        var extractGroupStep = plan.Steps.OfType<ExtractGroupStep>().SingleOrDefault();
        if (extractGroupStep is not null)
        {
            if (extractGroupStep.Roots.Count == 0)
                return Invalid("ExtractGroupStep must contain at least one group.");

            var groupError = ValidateContainerNodes(extractGroupStep.Roots, plan.Engine);
            if (groupError is not null)
                return Invalid(groupError);

            // Issue #192: container mode's own leaf field names (DataFieldNode
            // only — GroupNode names aren't mappable, the same leaf-only scope
            // the extension's own field picker already offers for this mode).
            if (plan.OutputBlueprint is { } containerBlueprint)
            {
                var containerFieldNames = CollectContainerFieldNames(extractGroupStep.Roots);

                if (containerBlueprint.SchemaKind == OutputBlueprintSchemaKind.Tree)
                {
                    // Issue #244: a tree-shaped mapping resolves one row
                    // scope PER TARGET GROUP NODE instead of one for the
                    // whole mapping — see
                    // OutputBlueprintFlattening.ResolveContainerTreeRowScopes
                    // for why this no longer needs the flat case's single
                    // "every mapped field on one ancestor chain" rule.
                    var treeError = ValidateOutputBlueprintTree(containerBlueprint.Tree, containerFieldNames);
                    if (treeError is not null)
                        return Invalid(treeError);

                    var treeScope = OutputBlueprintFlattening.ResolveContainerTreeRowScopes(extractGroupStep.Roots, containerBlueprint.Tree!);
                    if (treeScope.Error is not null)
                        return Invalid(treeScope.Error);
                }
                else
                {
                    var containerBlueprintError = ValidateOutputBlueprint(containerBlueprint, containerFieldNames);
                    if (containerBlueprintError is not null)
                        return Invalid(containerBlueprintError);

                    // Unlike a tree-shaped mapping, the flat mapping doesn't
                    // just remap columns — it flattens the tree into
                    // denormalized rows (see OutputBlueprintFlattening),
                    // which only has one unambiguous row layout when every
                    // mapped field sits on a single root-to-row repeating-
                    // group chain.
                    var mappedSourceFields = containerBlueprint.Fields!.Select(field => field.SourceField).ToHashSet();
                    var rowScope = OutputBlueprintFlattening.ResolveContainerRowScope(extractGroupStep.Roots, mappedSourceFields);
                    if (rowScope.Error is not null)
                        return Invalid(rowScope.Error);
                }
            }

            return new PlanValidationResult { Success = true };
        }

        // API-Mode replaces the flat ExtractStep list wholesale, just like
        // Container-Mode above — see ScrapingPlanBuilder.
        var apiCallStep = plan.Steps.OfType<ApiCallStep>().SingleOrDefault();
        if (apiCallStep is not null)
        {
            var apiError = ValidateApiConfig(apiCallStep.Config);
            if (apiError is not null)
                return Invalid(apiError);

            // Issue #191/#192: available field names depend on which of
            // Api's two response shapes is set — the flat ItemsPath/Fields
            // list, or (since #192) the tree shape's own leaf ApiField
            // names (ApiGroup names aren't mappable, same leaf-only scope
            // Container-Mode's own check just above applies).
            //
            // Unlike Container-Mode, there's no equivalent generate-time
            // row-scope/ambiguity check for the tree shape here: ApiGroup
            // has no explicit Repeating flag (Architecture Decision #6) —
            // whether a node actually repeats is only known once the real
            // JSON response is resolved at script run time. The same
            // ambiguity check this validator runs statically for Container-
            // Mode (OutputBlueprintFlattening) instead has a runtime mirror
            // in scraper_api_grouped.py.j2 itself, surfacing as a normal
            // 422 trial-run verification failure rather than a 400 here.
            if (plan.OutputBlueprint is { } apiBlueprint)
            {
                var apiHasGroupsForBlueprint = apiCallStep.Config.Groups is { Count: > 0 };
                var apiAvailableFields = apiHasGroupsForBlueprint
                    ? CollectApiFieldNames(apiCallStep.Config.Groups!)
                    : (apiCallStep.Config.Fields ?? []).Select(field => field.Name).ToList();

                if (apiBlueprint.SchemaKind == OutputBlueprintSchemaKind.Tree)
                {
                    // Issue #244: only meaningful against Api's own tree
                    // shape — a tree target has nothing to nest against a
                    // flat response.
                    if (!apiHasGroupsForBlueprint)
                        return Invalid("OutputBlueprint: a tree-shaped target schema requires Api's tree response shape (Groups) — use a flat target schema for Api's flat ItemsPath/Fields shape.");

                    var apiTreeError = ValidateOutputBlueprintTree(apiBlueprint.Tree, apiAvailableFields);
                    if (apiTreeError is not null)
                        return Invalid(apiTreeError);

                    // No static row-scope check here, same reasoning as the
                    // flat mapping's own asymmetry with Container-Mode just
                    // above: ApiGroup has no explicit Repeating flag
                    // (Architecture Decision #6), so the per-target-group
                    // scope resolution can only happen once the real JSON
                    // response is resolved at script run time — see
                    // scraper_api_grouped.py.j2's own runtime mirror of
                    // ResolveContainerTreeRowScopes.
                }
                else
                {
                    var apiBlueprintError = ValidateOutputBlueprint(apiBlueprint, apiAvailableFields);
                    if (apiBlueprintError is not null)
                        return Invalid(apiBlueprintError);
                }
            }

            return new PlanValidationResult { Success = true };
        }

        var extractSteps = plan.Steps.OfType<ExtractStep>().ToList();
        if (extractSteps.Count == 0)
            return Invalid("Plan must contain at least one ExtractStep.");

        foreach (var step in extractSteps)
        {
            if (string.IsNullOrWhiteSpace(step.Name))
                return Invalid("Field name must not be empty.");
            if (string.IsNullOrWhiteSpace(step.Selector))
                return Invalid($"Selector for field '{step.Name}' must not be empty.");

            // FramePath is Browser-engine-only, unlike ExtractStep itself
            // (used by both engines) — so this can't join browserOnlySteps
            // above, which gates on step *type*, not a per-step property.
            var frameError = ValidateFramePath(step.FramePath, $"field '{step.Name}'", plan.Engine);
            if (frameError is not null)
                return Invalid(frameError);

            var transformError = FieldTransformValidator.Validate(step.Transforms, $"field '{step.Name}'");
            if (transformError is not null)
                return Invalid(transformError);
        }

        var duplicateNames = FindDuplicates(extractSteps, step => step.Name);
        if (duplicateNames.Count > 0)
            return Invalid($"Duplicate field names: {string.Join(", ", duplicateNames)}.");

        if (plan.OutputBlueprint is { } blueprint)
        {
            // Issue #244: a tree target schema has nothing to nest against
            // flat Fields — the same exclusion applies to Api's own flat
            // shape just above.
            if (blueprint.SchemaKind == OutputBlueprintSchemaKind.Tree)
                return Invalid("OutputBlueprint: a tree-shaped target schema requires Groups or Api.Groups (tree-shaped source data) — use a flat target schema for flat fields.");

            var blueprintError = ValidateOutputBlueprint(blueprint, extractSteps.Select(step => step.Name).ToList());
            if (blueprintError is not null)
                return Invalid(blueprintError);
        }

        return new PlanValidationResult { Success = true };
    }

    // Issue #191: availableSourceFields is the mode's own already-resolved
    // field-name list (flat ExtractStep.Name, or Api-flat ApiField.Name —
    // API parameters are deliberately not mappable, the same simplification
    // NullRateCheck/RequiredFieldsCheck's own field pickers already made for
    // API mode). Mirrors FieldTransformValidator's "static helper returning
    // string? (null = valid)" pattern.
    private static string? ValidateOutputBlueprint(OutputBlueprintMapping mapping, IReadOnlyCollection<string> availableSourceFields)
    {
        if (mapping.Fields is not { Count: > 0 })
            return "OutputBlueprint needs at least one field mapping.";

        foreach (var entry in mapping.Fields)
        {
            if (string.IsNullOrWhiteSpace(entry.TargetField))
                return "OutputBlueprint: target field name must not be empty.";
            if (string.IsNullOrWhiteSpace(entry.SourceField))
                return $"OutputBlueprint: target field '{entry.TargetField}' needs a mapped source field.";
            if (!availableSourceFields.Contains(entry.SourceField))
                return $"OutputBlueprint: unknown source field '{entry.SourceField}' for target field '{entry.TargetField}'.";
        }

        var duplicateTargets = FindDuplicates(mapping.Fields, entry => entry.TargetField);
        if (duplicateTargets.Count > 0)
            return $"OutputBlueprint: duplicate target field(s): {string.Join(", ", duplicateTargets)}.";

        var duplicateSources = FindDuplicates(mapping.Fields, entry => entry.SourceField);
        if (duplicateSources.Count > 0)
            return $"OutputBlueprint: source field(s) mapped more than once: {string.Join(", ", duplicateSources)}.";

        return null;
    }

    // Issue #244: the tree-shaped counterpart to ValidateOutputBlueprint
    // above — availableSourceFields is still the mode's own already-resolved
    // LEAF field-name list (container mode's DataFieldNode names, or Api-
    // tree's ApiField names), exactly as ValidateOutputBlueprint already
    // uses for the flat case. Unlike the flat mapping, duplicate TARGET node
    // names are deliberately not rejected here — they're just output tag/key
    // names, and container mode's own tree already allows duplicate sibling
    // names by design (see Issue #177) — only duplicate SOURCE fields are
    // still rejected, preserving the "still 1:1 per field" scope boundary
    // #191/#192 already established.
    private static string? ValidateOutputBlueprintTree(List<OutputBlueprintTreeMappingNode>? tree, IReadOnlyCollection<string> availableSourceFields)
    {
        if (tree is not { Count: > 0 })
            return "OutputBlueprint: a tree-shaped mapping needs at least one target node.";

        var sourceFields = new List<string>();

        string? Walk(IEnumerable<OutputBlueprintTreeMappingNode> nodes)
        {
            foreach (var node in nodes)
            {
                if (string.IsNullOrWhiteSpace(node.Name))
                    return "OutputBlueprint: target node name must not be empty.";

                switch (node)
                {
                    case OutputBlueprintTreeMappingGroup group:
                        var childError = Walk(group.Children);
                        if (childError is not null)
                            return childError;
                        break;
                    case OutputBlueprintTreeMappingField field:
                        if (string.IsNullOrWhiteSpace(field.SourceField))
                            return $"OutputBlueprint: target field '{field.Name}' needs a mapped source field.";
                        if (!availableSourceFields.Contains(field.SourceField))
                            return $"OutputBlueprint: unknown source field '{field.SourceField}' for target field '{field.Name}'.";
                        sourceFields.Add(field.SourceField);
                        break;
                }
            }
            return null;
        }

        var error = Walk(tree);
        if (error is not null)
            return error;

        if (sourceFields.Count == 0)
            return "OutputBlueprint needs at least one field mapping.";

        var duplicateSources = FindDuplicates(sourceFields, name => name);
        if (duplicateSources.Count > 0)
            return $"OutputBlueprint: source field(s) mapped more than once: {string.Join(", ", duplicateSources)}.";

        return null;
    }

    // Issue #192: leaf field names only (DataFieldNode, not GroupNode) —
    // mirrors ValidateContainerNodes' own recursive walk, and the
    // extension's own collectFieldNames() for this mode, which likewise
    // never offers a group's own name as a mappable source field.
    private static List<string> CollectContainerFieldNames(IEnumerable<ContainerNode> nodes)
    {
        var names = new List<string>();
        void Walk(IEnumerable<ContainerNode> ns)
        {
            foreach (var node in ns)
            {
                if (node is DataFieldNode field) names.Add(field.Name);
                else if (node is GroupNode group) Walk(group.Children);
            }
        }
        Walk(nodes);
        return names;
    }

    // Mirrors CollectContainerFieldNames for API-Mode's tree shape (Issue
    // #54) — leaf ApiField names only, not ApiGroup names.
    private static List<string> CollectApiFieldNames(IEnumerable<ApiNode> nodes)
    {
        var names = new List<string>();
        void Walk(IEnumerable<ApiNode> ns)
        {
            foreach (var node in ns)
            {
                if (node is ApiField field) names.Add(field.Name);
                else if (node is ApiGroup group) Walk(group.Children);
            }
        }
        Walk(nodes);
        return names;
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
                return "Name of a container node must not be empty.";

            switch (node)
            {
                case GroupNode group:
                    if (string.IsNullOrWhiteSpace(group.Selector))
                        return $"Selector of group '{group.Name}' must not be empty.";
                    var groupFrameError = ValidateFramePath(group.FramePath, $"group '{group.Name}'", engine);
                    if (groupFrameError is not null)
                        return groupFrameError;
                    var childError = ValidateContainerNodes(group.Children, engine);
                    if (childError is not null)
                        return childError;
                    break;

                case DataFieldNode field:
                    if (string.IsNullOrWhiteSpace(field.Selector))
                        return $"Selector of data field '{field.Name}' must not be empty.";
                    if (field.Mode == ExtractMode.Attribute && string.IsNullOrWhiteSpace(field.Attribute))
                        return $"Data field '{field.Name}' with mode 'Attribute' needs an attribute.";
                    var fieldFrameError = ValidateFramePath(field.FramePath, $"data field '{field.Name}'", engine);
                    if (fieldFrameError is not null)
                        return fieldFrameError;
                    var fieldTransformError = FieldTransformValidator.Validate(field.Transforms, $"data field '{field.Name}'");
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
                return "Name of an Api node must not be empty.";

            switch (node)
            {
                case ApiGroup group:
                    if (group.Children.Count == 0)
                        return $"Group '{group.Name}' needs at least one child element.";
                    var childError = ValidateApiNodes(group.Children);
                    if (childError is not null)
                        return childError;
                    break;

                case ApiField field:
                    if (string.IsNullOrWhiteSpace(field.Path))
                        return $"Path of field '{field.Name}' must not be empty.";
                    var apiFieldTransformError = FieldTransformValidator.Validate(field.Transforms, $"field '{field.Name}'");
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
                        return "Property name in Body must not be empty.";
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
                    return $"Body references unknown parameter '{variable.ParameterName}'.";
                referencedParameterNames.Add(variable.ParameterName);
                return null;

            case ApiBodyLiteral literal:
                return literal.Kind switch
                {
                    ApiBodyLiteralKind.String when literal.StringValue is null =>
                        "Body literal of type 'String' needs StringValue.",
                    ApiBodyLiteralKind.Number when literal.NumberValue is null =>
                        "Body literal of type 'Number' needs NumberValue.",
                    ApiBodyLiteralKind.Boolean when literal.BoolValue is null =>
                        "Body literal of type 'Boolean' needs BoolValue.",
                    ApiBodyLiteralKind.Null when literal.StringValue is not null || literal.NumberValue is not null || literal.BoolValue is not null =>
                        "Body literal of type 'Null' must not have any value set.",
                    _ => null,
                };

            default:
                throw new NotSupportedException($"Unknown ApiBodyNode type: {node.GetType()}");
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
            return $"FramePath for {context} requires Engine 'Browser'.";
        if (framePath.Count == 0)
            return $"FramePath for {context} must not be empty when set.";
        if (framePath.Any(string.IsNullOrWhiteSpace))
            return $"FramePath for {context} must not contain empty segments.";
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
            return $"Unsupported HTTP method '{api.Method}': Api mode currently only supports GET and POST.";

        // Body (Issue #55) requires Method == "POST" — a bodyless POST is
        // still valid, a GET with a Body makes no sense and is rejected
        // here rather than silently ignored.
        if (api.Body is not null && api.Method != "POST")
            return "Body requires method 'POST'.";

        // EmbeddedJsonSource (Issue #136) is orthogonal to the flat-vs-tree
        // response shape below — it only changes where the JSON to run
        // ItemsPath/Fields/Groups against comes from, not its shape — but a
        // page load is always a plain GET with no request body. Requiring
        // GET here is also what transitively rejects Body: the check above
        // already requires Method == "POST" whenever Body is set, so a
        // config with both Body and EmbeddedJsonSource always fails on this
        // GET requirement first, with no separate check needed.
        if (api.EmbeddedJsonSource is { } embeddedJsonSource)
        {
            if (api.Method != "GET")
                return "EmbeddedJsonSource requires method 'GET'.";
            if (string.IsNullOrWhiteSpace(embeddedJsonSource.ScriptSelector))
                return "EmbeddedJsonSource needs a ScriptSelector.";
        }

        // Two mutually exclusive response shapes (Issue #54): the original
        // flat ItemsPath+Fields (exactly one repetition level), or the
        // recursive Groups tree (arbitrarily deep). Exactly one of the two
        // must be set.
        var hasFlat = api.ItemsPath is not null || api.Fields is not null;
        var hasGroups = api.Groups is { Count: > 0 };

        if (hasFlat && hasGroups)
            return "ItemsPath/Fields and Groups are mutually exclusive.";
        if (!hasFlat && !hasGroups)
            return "Api configuration needs either ItemsPath and Fields, or Groups.";

        if (hasFlat)
        {
            if (api.ItemsPath is null || api.Fields is null)
                return "ItemsPath and Fields must both be set if either one is set.";

            if (string.IsNullOrWhiteSpace(api.ItemsPath))
                return "ItemsPath must not be empty.";

            if (api.Fields.Count == 0)
                return "Api configuration must contain at least one field.";

            foreach (var field in api.Fields)
            {
                if (string.IsNullOrWhiteSpace(field.Name))
                    return "Field name must not be empty.";
                if (string.IsNullOrWhiteSpace(field.Path))
                    return $"Path for field '{field.Name}' must not be empty.";
                var transformError = FieldTransformValidator.Validate(field.Transforms, $"field '{field.Name}'");
                if (transformError is not null)
                    return transformError;
            }

            var duplicateFieldNames = FindDuplicates(api.Fields, field => field.Name);
            if (duplicateFieldNames.Count > 0)
                return $"Duplicate field names: {string.Join(", ", duplicateFieldNames)}.";

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
                return $"Field name(s) collide with parameter names: {string.Join(", ", collidingNames)}.";
        }
        else
        {
            var treeError = ValidateApiNodes(api.Groups!);
            if (treeError is not null)
                return treeError;

            if (!ApiNodesContainField(api.Groups!))
                return "Api configuration (Groups) must contain at least one field.";
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
                return "Parameter name must not be empty.";
        }

        var duplicateParameterNames = FindDuplicates(api.Parameters, parameter => parameter.Name);
        if (duplicateParameterNames.Count > 0)
            return $"Duplicate parameter names: {string.Join(", ", duplicateParameterNames)}.";

        var placeholders = UrlTemplatePlaceholderPattern.Matches(api.UrlTemplate)
            .Select(match => match.Groups[1].Value)
            .ToHashSet();
        var parameterNames = api.Parameters.Select(parameter => parameter.Name).ToHashSet();

        var missingParameters = placeholders.Except(parameterNames).ToList();
        if (missingParameters.Count > 0)
            return $"UrlTemplate references unknown parameters: {string.Join(", ", missingParameters)}.";

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
            return $"Parameters with no placeholder in UrlTemplate: {string.Join(", ", unusedParameters)}.";

        foreach (var parameter in api.Parameters)
        {
            var sourceError = parameter.Source switch
            {
                StaticListSource { Values.Count: 0 } =>
                    $"Parameter '{parameter.Name}' with a value list needs at least one value.",
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

    private static string? ValidateApiHeaders(List<ApiHeader> headers)
    {
        foreach (var header in headers)
        {
            if (string.IsNullOrWhiteSpace(header.Name))
                return "Name of an Api header must not be empty.";

            var hasValue = !string.IsNullOrWhiteSpace(header.Value);
            var hasEnvironmentVariable = !string.IsNullOrWhiteSpace(header.EnvironmentVariableName);
            if (hasValue == hasEnvironmentVariable)
                return $"Header '{header.Name}' needs exactly one of Value/EnvironmentVariableName.";

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

    // Issue #87: every field here is an env var *name* (like
    // FillAction.EnvironmentVariableName), never a literal value — same
    // EnvironmentVariableNamePattern check as everywhere else that's true.
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

    // Issue #88: only the env var *name* is validated here — the companion
    // never sees the actual proxy URLs (same boundary as FillAction/
    // ChangeDetection credentials).
    private static string? ValidateProxy(ProxyConfig proxy) =>
        EnvironmentVariableNamePattern.IsMatch(proxy.EnvironmentVariableName)
            ? null
            : $"Invalid environment variable name '{proxy.EnvironmentVariableName}' in Proxy.EnvironmentVariableName.";

    // Issue #174: MaxPages is checked regardless of kind; the two kinds then
    // each validate their own one required field. PageNumberPagination.
    // UrlTemplate must reference both "{url}" and "{page}" — reused via the
    // same UrlTemplatePlaceholderPattern API-mode's own UrlTemplate
    // validation already uses above, just checked by presence rather than
    // matched against a declared Parameters list (there's no equivalent
    // concept here).
    private static string? ValidatePagination(PaginationConfig pagination)
    {
        if (pagination.MaxPages <= 0)
            return $"Pagination.MaxPages must be positive (was {pagination.MaxPages}).";

        return pagination switch
        {
            NextLinkPagination nextLink => string.IsNullOrWhiteSpace(nextLink.NextLinkSelector)
                ? "NextLinkPagination.NextLinkSelector must not be empty."
                : null,
            PageNumberPagination pageNumber => ValidatePageNumberUrlTemplate(pageNumber.UrlTemplate),
            _ => throw new InvalidOperationException($"Unknown PaginationConfig type: {pagination.GetType()}"),
        };
    }

    private static string? ValidatePageNumberUrlTemplate(string urlTemplate)
    {
        if (string.IsNullOrWhiteSpace(urlTemplate))
            return "PageNumberPagination.UrlTemplate must not be empty.";

        var placeholders = UrlTemplatePlaceholderPattern.Matches(urlTemplate).Select(match => match.Groups[1].Value).ToHashSet();
        var missing = new[] { "url", "page" }.Where(token => !placeholders.Contains(token)).ToList();
        return missing.Count > 0
            ? $"PageNumberPagination.UrlTemplate is missing placeholder(s): {string.Join(", ", missing.Select(token => $"{{{token}}}"))}."
            : null;
    }

    // Issue #182: at least 2 blocks (a single block is just Fields/Groups —
    // see ScrapingConfig.Blocks), unique Name/OutputFileBaseName across the
    // whole list (both already resolved by ScrapingPlanBuilder — a blank
    // Name/OutputFileName can never reach here as a blank string, only as
    // the resolved default), then each block's own content validated by
    // reusing the exact same per-shape/per-cross-cutting-config validators
    // the single-shape branches above already call.
    private static string? ValidateExtractionBlocks(List<PlanExtractionBlock> blocks, ScrapingEngine engine)
    {
        if (blocks.Count < 2)
            return $"Blocks requires at least 2 blocks (was {blocks.Count}).";

        var duplicateNames = FindDuplicates(blocks, block => block.Name);
        if (duplicateNames.Count > 0)
            return $"Duplicate block names: {string.Join(", ", duplicateNames)}.";

        var duplicateOutputFileNames = FindDuplicates(blocks, block => block.OutputFileBaseName);
        if (duplicateOutputFileNames.Count > 0)
            return $"Blocks resolve to duplicate output file names: {string.Join(", ", duplicateOutputFileNames)}.";

        foreach (var block in blocks)
        {
            if (block.Groups is { Count: > 0 } groups)
            {
                var groupError = ValidateContainerNodes(groups, engine);
                if (groupError is not null)
                    return $"Block '{block.Name}': {groupError}";
            }
            else if (block.Fields is { Count: > 0 } fields)
            {
                foreach (var step in fields)
                {
                    if (string.IsNullOrWhiteSpace(step.Name))
                        return $"Block '{block.Name}': field name must not be empty.";
                    if (string.IsNullOrWhiteSpace(step.Selector))
                        return $"Block '{block.Name}': selector for field '{step.Name}' must not be empty.";
                    var frameError = ValidateFramePath(step.FramePath, $"field '{step.Name}' in block '{block.Name}'", engine);
                    if (frameError is not null)
                        return frameError;
                    var transformError = FieldTransformValidator.Validate(step.Transforms, $"field '{step.Name}' in block '{block.Name}'");
                    if (transformError is not null)
                        return transformError;
                }

                var duplicateFieldNames = FindDuplicates(fields, step => step.Name);
                if (duplicateFieldNames.Count > 0)
                    return $"Block '{block.Name}': duplicate field names: {string.Join(", ", duplicateFieldNames)}.";
            }
            else
            {
                return $"Block '{block.Name}' must contain at least one field or group.";
            }

            if (block.ChangeDetection is { } changeDetection)
            {
                var changeDetectionError = ValidateChangeDetection(changeDetection);
                if (changeDetectionError is not null)
                    return $"Block '{block.Name}': {changeDetectionError}";
            }

            if (block.Hardening is { Count: > 0 } hardening)
            {
                var hardeningError = ValidateHardening(hardening);
                if (hardeningError is not null)
                    return $"Block '{block.Name}': {hardeningError}";
            }
        }

        return null;
    }

    // Issue #129/#130: every non-NullRate check kind (the concrete
    // HardeningCheck subtype, since there's no separate string "Kind"
    // property to compare on the C# side; that string only exists on the
    // wire/in the generated script) may appear at most once — Severity is a
    // required enum (an invalid string already fails deserialization before
    // this ever runs), and NoResultCheck has no parameters of its own, so
    // there's nothing that would distinguish two instances of it anyway.
    // NullRateCheck is deliberately exempt from that rule (see its own doc
    // comment) — more than one is expected, one per monitored field — so it
    // gets its own "duplicate FieldName" rule plus its own parameter checks
    // instead.
    private static string? ValidateHardening(List<HardeningCheck> hardening)
    {
        var duplicateKind = hardening
            .Where(check => check is not NullRateCheck)
            .GroupBy(check => check.GetType())
            .FirstOrDefault(group => group.Count() > 1)
            ?.Key.Name;
        if (duplicateKind is not null)
            return $"Hardening check '{duplicateKind}' is configured more than once.";

        var nullRateChecks = hardening.OfType<NullRateCheck>().ToList();

        var duplicateField = nullRateChecks
            .GroupBy(check => check.FieldName)
            .FirstOrDefault(group => group.Count() > 1)
            ?.Key;
        if (duplicateField is not null)
            return $"Hardening check 'NullRate' is configured more than once for field '{duplicateField}'.";

        foreach (var check in nullRateChecks)
        {
            if (string.IsNullOrWhiteSpace(check.FieldName))
                return "Hardening check 'NullRate' needs a field name.";
            if (check.Threshold is < 0 or > 1)
                return $"Hardening check 'NullRate' for field '{check.FieldName}': threshold must be between 0 and 1 (was {check.Threshold}).";
        }

        // Issue #131: only DropThreshold's own range needs checking —
        // BaselineCheck already goes through the generic duplicate-kind rule
        // above like NoResultCheck, since more than one never makes sense.
        foreach (var check in hardening.OfType<BaselineCheck>())
        {
            if (check.DropThreshold is < 0 or > 1)
                return $"Hardening check 'Baseline': threshold must be between 0 and 1 (was {check.DropThreshold}).";
        }

        // Issue #132: like BaselineCheck, only one BlockingCheck ever makes
        // sense (already covered by the generic duplicate-kind rule above).
        // MinBodyLength/BlockPhrases are both optional — a BlockingCheck
        // with neither set is still meaningful (the cross-origin-redirect
        // signal is always active), so there's no "at least one signal
        // configured" requirement here.
        foreach (var check in hardening.OfType<BlockingCheck>())
        {
            if (check.MinBodyLength is <= 0)
                return $"Hardening check 'Blocking': MinBodyLength must be positive (was {check.MinBodyLength}).";
            if (check.BlockPhrases?.Any(string.IsNullOrWhiteSpace) == true)
                return "Hardening check 'Blocking': block phrases must not be blank.";
        }

        // Issue #133 (+ #204 follow-up): unlike BlockingCheck's optional
        // signals, FieldNames is the one thing this check configures at
        // all, so — unlike an incomplete NullRateCheck row, which is simply
        // skipped client-side — an empty list is rejected here rather than
        // silently doing nothing. Supported for every shape (flat, Api-flat,
        // container, and — since #204 — Api-tree), so there's no per-shape
        // restriction to enforce anywhere else in this validator.
        foreach (var check in hardening.OfType<RequiredFieldsCheck>())
        {
            if (check.FieldNames.Count == 0)
                return "Hardening check 'RequiredFields' needs at least one field name.";
            if (check.FieldNames.Any(string.IsNullOrWhiteSpace))
                return "Hardening check 'RequiredFields': field names must not be blank.";
            var duplicateFieldName = FindDuplicates(check.FieldNames, name => name).FirstOrDefault();
            if (duplicateFieldName is not null)
                return $"Hardening check 'RequiredFields': duplicate field name '{duplicateFieldName}'.";
        }

        return null;
    }
}
