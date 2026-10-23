using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.Backends.Python;

namespace ScrapingFactory.Compiler.IR;

public static partial class ScrapingPlanValidator
{
    // Leaf ApiField names only.
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

    // Mirror of ValidateContainerNodes. ApiField.Path must be non-empty (unlike ApiGroup.Path, where "" means the parent scope).
    private static string? ValidateApiNodes(IEnumerable<ApiNode> nodes)
    {
        // One scope per group, as in ValidateContainerNodes.
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

    // A tree of only empty groups would extract nothing.
    private static bool ApiNodesContainField(IEnumerable<ApiNode> nodes) =>
        nodes.Any(node => node switch
        {
            ApiField => true,
            ApiGroup group => ApiNodesContainField(group.Children),
            _ => false,
        });

    // Request-body tree: a Variable must reference a declared parameter (collected into referencedParameterNames), and a Literal's Kind must
    // match the value that is set (Kind is not inferred, so a mismatch would silently send a wrong value).
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
