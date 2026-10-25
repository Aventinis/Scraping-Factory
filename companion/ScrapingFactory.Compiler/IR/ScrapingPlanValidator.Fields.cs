using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.Backends.Python;

namespace ScrapingFactory.Compiler.IR;

public static partial class ScrapingPlanValidator
{
    // A field whose value comes from a leading combineFields/splitField transform has no selector or path of its own.
    private static bool IsDerivedField(IReadOnlyList<FieldTransform>? transforms) =>
        transforms is { Count: > 0 } && transforms[0] is CombineFieldsTransform or SplitFieldTransform;

    // A combine/split transform reads another field's already-computed value, so that field must be declared earlier in the
    // same scope (callers pass the siblings of one list or one group), and not be the field itself.
    private static string? ValidateFieldTransformOrdering(IReadOnlyList<FieldTransform>? transforms, string fieldName, IReadOnlyList<string> precedingSiblingNames, string fieldLabel)
    {
        if (transforms is null)
            return null;

        foreach (var transform in transforms)
        {
            IReadOnlyList<string>? referenced = transform switch
            {
                CombineFieldsTransform combine => combine.SourceFieldNames,
                SplitFieldTransform split => new[] { split.SourceFieldName },
                _ => null,
            };
            if (referenced is null)
                continue;

            foreach (var name in referenced)
            {
                if (name == fieldName)
                    return $"{fieldLabel}: a combine/split transform cannot reference its own field.";
                if (!precedingSiblingNames.Contains(name))
                    return $"{fieldLabel}: combine/split transform references '{name}', which must be another field declared earlier in the same list.";
            }
        }

        return null;
    }

    // Leaf field names only: a group's own name is not a mappable source field.
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

    // Shared by flat and container Download; whether Download is enabled is checked by each caller.
    private static string? ValidateDownloadSafetyNet(int? maxSizeBytes, List<string>? allowedContentTypes, string fieldDescription)
    {
        if (maxSizeBytes is <= 0)
            return $"Max download size for {fieldDescription} must be greater than zero.";
        if (allowedContentTypes is { Count: > 0 } && allowedContentTypes.Any(string.IsNullOrWhiteSpace))
            return $"Allowed content type list for {fieldDescription} must not contain blank entries.";
        return null;
    }

    // Tag names and whether a non-repeating group matches more than once are not checked; the trial run reports those.
    private static string? ValidateContainerNodes(IEnumerable<ContainerNode> nodes, ScrapingEngine engine)
    {
        // One scope per call: a combine/split transform may only reference a sibling declared earlier in the same group.
        var precedingFieldNames = new List<string>();
        foreach (var node in nodes)
        {
            if (string.IsNullOrWhiteSpace(node.Name))
                return "Name of a container node must not be empty.";

            switch (node)
            {
                case GroupNode group:
                    if (string.IsNullOrWhiteSpace(group.Selector))
                        return $"Selector of group '{group.Name}' must not be empty.";
                    var groupSelectorError = SelectorTextFilter.Validate(group.Selector, $"Selector of group '{group.Name}'");
                    if (groupSelectorError is not null)
                        return groupSelectorError;
                    var groupFrameError = ValidateFramePath(group.FramePath, $"group '{group.Name}'", engine);
                    if (groupFrameError is not null)
                        return groupFrameError;
                    var childError = ValidateContainerNodes(group.Children, engine);
                    if (childError is not null)
                        return childError;
                    break;

                case DataFieldNode field:
                    if (string.IsNullOrWhiteSpace(field.Selector) && !IsDerivedField(field.Transforms))
                        return $"Selector of data field '{field.Name}' must not be empty.";
                    var dataFieldSelectorError = SelectorTextFilter.Validate(field.Selector, $"Selector of data field '{field.Name}'");
                    if (dataFieldSelectorError is not null)
                        return dataFieldSelectorError;
                    if (field.Mode == ExtractMode.Attribute && string.IsNullOrWhiteSpace(field.Attribute))
                        return $"Data field '{field.Name}' with mode 'Attribute' needs an attribute.";
                    if (field.Download && field.Mode != ExtractMode.Attribute)
                        return $"Data field '{field.Name}' has Download enabled but is not in 'Attribute' mode — there is no URL value to download.";
                    var downloadError = ValidateDownloadSafetyNet(field.MaxDownloadSizeBytes, field.AllowedContentTypes, $"data field '{field.Name}'");
                    if (downloadError is not null)
                        return downloadError;
                    var fieldFrameError = ValidateFramePath(field.FramePath, $"data field '{field.Name}'", engine);
                    if (fieldFrameError is not null)
                        return fieldFrameError;
                    var fieldTransformError = FieldTransformValidator.Validate(field.Transforms, $"data field '{field.Name}'");
                    if (fieldTransformError is not null)
                        return fieldTransformError;
                    var orderError = ValidateFieldTransformOrdering(field.Transforms, field.Name, precedingFieldNames, $"data field '{field.Name}'");
                    if (orderError is not null)
                        return orderError;
                    precedingFieldNames.Add(field.Name);
                    break;
            }
        }
        return null;
    }
}
