using ScrapingFactory.Compiler.Backends.Python;

namespace ScrapingFactory.Compiler.IR;

// The checks that depend on which extraction shape a plan has: container tree, API call, or the flat field list.
public static partial class ScrapingPlanValidator
{
    private static string? ValidateContainerPlan(ScrapingPlan plan, ExtractGroupStep step)
    {
        if (step.Roots.Count == 0)
            return "ExtractGroupStep must contain at least one group.";

        var groupError = ValidateContainerNodes(step.Roots, plan.Engine);
        if (groupError is not null)
            return groupError;

        if (plan.OutputBlueprint is { } blueprint)
        {
            var blueprintError = ValidateContainerBlueprint(blueprint, step.Roots);
            if (blueprintError is not null)
                return blueprintError;
        }

        return plan.Deduplication is { } dedup
            ? ValidateDeduplication(dedup, CollectContainerFieldNames(step.Roots), isTreeShape: true, plan.OutputBlueprint is not null)
            : null;
    }

    // Only leaf fields are mappable. A tree mapping resolves one row scope per target group; the flat mapping flattens
    // the tree into rows, which needs every mapped field on one repeating-group chain (OutputBlueprintFlattening).
    private static string? ValidateContainerBlueprint(OutputBlueprintMapping blueprint, List<GroupNode> roots)
    {
        var fieldNames = CollectContainerFieldNames(roots);

        if (blueprint.SchemaKind == OutputBlueprintSchemaKind.Tree)
        {
            var treeError = ValidateOutputBlueprintTree(blueprint.Tree, fieldNames);
            if (treeError is not null)
                return treeError;

            return OutputBlueprintFlattening.ResolveContainerTreeRowScopes(roots, blueprint.Tree!).Error;
        }

        var flatError = ValidateOutputBlueprint(blueprint, fieldNames);
        if (flatError is not null)
            return flatError;

        var mappedSourceFields = blueprint.Fields!.Select(field => field.SourceField).ToHashSet();
        return OutputBlueprintFlattening.ResolveContainerRowScope(roots, mappedSourceFields).Error;
    }

    private static string? ValidateApiPlan(ScrapingPlan plan, ApiCallStep step)
    {
        var apiError = ValidateApiConfig(step.Config);
        if (apiError is not null)
            return apiError;

        var hasGroups = step.Config.Groups is { Count: > 0 };

        if (plan.OutputBlueprint is { } blueprint)
        {
            var availableFields = hasGroups
                ? CollectApiFieldNames(step.Config.Groups!)
                : (step.Config.Fields ?? []).Select(field => field.Name).ToList();
            var blueprintError = ValidateApiBlueprint(blueprint, availableFields, hasGroups);
            if (blueprintError is not null)
                return blueprintError;
        }

        if (plan.Deduplication is { } dedup)
        {
            // Flat rows also carry each parameter's value as a column, so a parameter name is a valid key field there.
            var dedupFields = hasGroups
                ? CollectApiFieldNames(step.Config.Groups!)
                : (step.Config.Fields ?? []).Select(field => field.Name)
                    .Concat((step.Config.Parameters ?? []).Select(parameter => parameter.Name)).ToList();
            return ValidateDeduplication(dedup, dedupFields, hasGroups, plan.OutputBlueprint is not null);
        }

        return null;
    }

    // Unlike container mode there is no static row-scope check: ApiGroup has no Repeating flag (Architecture Decision
    // #6), so the scope is resolved at run time by scraper_api_grouped.py.j2 and fails as a 422 trial-run error.
    private static string? ValidateApiBlueprint(OutputBlueprintMapping blueprint, List<string> availableFields, bool hasGroups)
    {
        if (blueprint.SchemaKind != OutputBlueprintSchemaKind.Tree)
            return ValidateOutputBlueprint(blueprint, availableFields);

        if (!hasGroups)
            return "OutputBlueprint: a tree-shaped target schema requires Api's tree response shape (Groups) — use a flat target schema for Api's flat ItemsPath/Fields shape.";

        return ValidateOutputBlueprintTree(blueprint.Tree, availableFields);
    }

    private static string? ValidateFlatPlan(ScrapingPlan plan)
    {
        var extractSteps = plan.Steps.OfType<ExtractStep>().ToList();
        if (extractSteps.Count == 0)
            return "Plan must contain at least one ExtractStep.";

        var precedingFieldNames = new List<string>();
        foreach (var step in extractSteps)
        {
            var fieldError = ValidateFlatField(step, plan.Engine, precedingFieldNames);
            if (fieldError is not null)
                return fieldError;
            precedingFieldNames.Add(step.Name);
        }

        var duplicateNames = FindDuplicates(extractSteps, step => step.Name);
        if (duplicateNames.Count > 0)
            return $"Duplicate field names: {string.Join(", ", duplicateNames)}.";

        var fieldNames = extractSteps.Select(step => step.Name).ToList();

        if (plan.OutputBlueprint is { } blueprint)
        {
            if (blueprint.SchemaKind == OutputBlueprintSchemaKind.Tree)
                return "OutputBlueprint: a tree-shaped target schema requires Groups or Api.Groups (tree-shaped source data) — use a flat target schema for flat fields.";

            var blueprintError = ValidateOutputBlueprint(blueprint, fieldNames);
            if (blueprintError is not null)
                return blueprintError;
        }

        return plan.Deduplication is { } dedup
            ? ValidateDeduplication(dedup, fieldNames, isTreeShape: false, plan.OutputBlueprint is not null)
            : null;
    }

    private static string? ValidateFlatField(ExtractStep step, ScrapingEngine engine, IReadOnlyList<string> precedingFieldNames)
    {
        if (string.IsNullOrWhiteSpace(step.Name))
            return "Field name must not be empty.";
        if (string.IsNullOrWhiteSpace(step.Selector) && !IsDerivedField(step.Transforms))
            return $"Selector for field '{step.Name}' must not be empty.";

        // FramePath is a per-step property used by both engines, so it can't join the step-type gate in ValidateBrowserSteps.
        return SelectorTextFilter.Validate(step.Selector, $"Selector for field '{step.Name}'")
            ?? ValidateFramePath(step.FramePath, $"field '{step.Name}'", engine)
            ?? FieldTransformValidator.Validate(step.Transforms, $"field '{step.Name}'")
            ?? ValidateFieldTransformOrdering(step.Transforms, step.Name, precedingFieldNames, $"field '{step.Name}'")
            ?? ValidateFlatDownload(step);
    }

    private static string? ValidateFlatDownload(ExtractStep step)
    {
        if (step.Download && string.IsNullOrWhiteSpace(step.Attribute))
            return $"Field '{step.Name}' has Download enabled but has no attribute configured — there is no URL value to download.";
        return ValidateDownloadSafetyNet(step.MaxDownloadSizeBytes, step.AllowedContentTypes, $"field '{step.Name}'");
    }
}
