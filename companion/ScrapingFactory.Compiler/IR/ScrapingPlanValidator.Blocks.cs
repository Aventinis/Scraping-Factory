using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.Backends.Python;

namespace ScrapingFactory.Compiler.IR;

public static partial class ScrapingPlanValidator
{
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
                var precedingFieldNames = new List<string>();
                foreach (var step in fields)
                {
                    if (string.IsNullOrWhiteSpace(step.Name))
                        return $"Block '{block.Name}': field name must not be empty.";
                    if (string.IsNullOrWhiteSpace(step.Selector))
                        return $"Block '{block.Name}': selector for field '{step.Name}' must not be empty.";
                    var blockSelectorError = SelectorTextFilter.Validate(step.Selector, $"Block '{block.Name}': selector for field '{step.Name}'");
                    if (blockSelectorError is not null)
                        return blockSelectorError;
                    var frameError = ValidateFramePath(step.FramePath, $"field '{step.Name}' in block '{block.Name}'", engine);
                    if (frameError is not null)
                        return frameError;
                    var transformError = FieldTransformValidator.Validate(step.Transforms, $"field '{step.Name}' in block '{block.Name}'");
                    if (transformError is not null)
                        return transformError;
                    var orderError = ValidateFieldTransformOrdering(step.Transforms, step.Name, precedingFieldNames, $"field '{step.Name}' in block '{block.Name}'");
                    if (orderError is not null)
                        return orderError;
                    precedingFieldNames.Add(step.Name);
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
}
