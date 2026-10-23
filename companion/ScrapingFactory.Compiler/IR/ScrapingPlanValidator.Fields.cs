using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.Backends.Python;

namespace ScrapingFactory.Compiler.IR;

public static partial class ScrapingPlanValidator
{
    // Issue #206: CombineFieldsTransform/SplitFieldTransform reference
    // another field's own already-computed value by name (see
    // FieldTransform.cs's own doc comment) — the runtime only ever has that
    // value available once extraction has already reached that sibling, so
    // the referenced name must be a field declared *earlier* in the very
    // same list precedingSiblingNames represents. Callers reset this list
    // per scope: the whole field list for flat/Api-flat mode, or just one
    // group's own Children for container/Api-tree mode (siblings under a
    // *different* parent group are out of scope entirely, mirroring how the
    // Python runtime only ever has the current scope's own in-progress
    // values on hand — see CLAUDE.md's Python Templates section).
    // Issue #206 follow-up: a field whose entire value comes from a
    // combineFields/splitField transform has no DOM value/JSON path of its
    // own to select — the extension's dedicated creation flow for these two
    // kinds never collects one, so Selector/Path is allowed to be blank
    // precisely (and only) in this case. Must be the *first* transform —
    // that's already the only shape the extension ever produces (a derived
    // field carries exactly one transform), and requiring it here instead
    // of "anywhere in the chain" keeps the check cheap and unambiguous.
    private static bool IsDerivedField(IReadOnlyList<FieldTransform>? transforms) =>
        transforms is { Count: > 0 } && transforms[0] is CombineFieldsTransform or SplitFieldTransform;

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

    // Issue #214: shared by both flat ExtractStep.Download and container
    // DataFieldNode.Download — a mode/shape-agnostic check on the optional
    // safety net alongside Download itself (whether Download is actually
    // enabled at all is validated separately by each caller, the same way
    // Attribute-mode-requiredness already is).
    private static string? ValidateDownloadSafetyNet(int? maxSizeBytes, List<string>? allowedContentTypes, string fieldDescription)
    {
        if (maxSizeBytes is <= 0)
            return $"Max download size for {fieldDescription} must be greater than zero.";
        if (allowedContentTypes is { Count: > 0 } && allowedContentTypes.Any(string.IsNullOrWhiteSpace))
            return $"Allowed content type list for {fieldDescription} must not contain blank entries.";
        return null;
    }

    // Deliberately doesn't check whether Name is a valid XML tag name, or
    // whether a non-repeating GroupNode's selector could ever match more
    // than once — same laissez-faire as CSS selector syntax elsewhere in
    // this validator (see class doc comment): a bad tag name surfaces as a
    // real Python exception via PythonScriptVerifier, not here.
    private static string? ValidateContainerNodes(IEnumerable<ContainerNode> nodes, ScrapingEngine engine)
    {
        // Issue #206: one scope per call (a fresh ValidateContainerNodes
        // call per group's own Children) — a combine/split transform can
        // only reference a sibling DataFieldNode already declared earlier
        // within this exact scope, never a node under a different group.
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
