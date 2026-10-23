using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.Backends.Python;

namespace ScrapingFactory.Compiler.IR;

public static partial class ScrapingPlanValidator
{
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

    // Mirrors ValidateContainerNodes for API-Mode's JSON-path tree (Issue
    // #54): same non-empty-name rule and recursive walk. Path itself stays
    // deliberately unvalidated (see ValidateApiConfig's doc comment) except
    // ApiField.Path, which — unlike ApiGroup.Path — must be non-empty: an
    // empty ApiGroup.Path is a legitimate "operate directly on the parent
    // scope" marker (see ApiGroup's doc comment), but an empty ApiField.Path
    // would silently extract nothing.
    private static string? ValidateApiNodes(IEnumerable<ApiNode> nodes)
    {
        // Issue #206: same per-scope tracking as ValidateContainerNodes —
        // a combine/split transform can only reference a sibling ApiField
        // already declared earlier within this exact group's own Children.
        var precedingFieldNames = new List<string>();
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
                    if (string.IsNullOrWhiteSpace(field.Path) && !IsDerivedField(field.Transforms))
                        return $"Path of field '{field.Name}' must not be empty.";
                    var apiFieldTransformError = FieldTransformValidator.Validate(field.Transforms, $"field '{field.Name}'");
                    if (apiFieldTransformError is not null)
                        return apiFieldTransformError;
                    var orderError = ValidateFieldTransformOrdering(field.Transforms, field.Name, precedingFieldNames, $"field '{field.Name}'");
                    if (orderError is not null)
                        return orderError;
                    precedingFieldNames.Add(field.Name);
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
}
