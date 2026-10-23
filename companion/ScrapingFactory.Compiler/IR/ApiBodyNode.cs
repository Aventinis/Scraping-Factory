namespace ScrapingFactory.Compiler.IR;

// What to write at one position of the outgoing request body, the write-side mirror of ApiGroup/ApiField.
// A leaf is a fixed literal or a reference by name to an ApiConfig.Parameters entry, so no second value-source
// concept exists.
public abstract class ApiBodyNode
{
}

public sealed class ApiBodyObject : ApiBodyNode
{
    public required Dictionary<string, ApiBodyNode> Properties { get; init; }
}

public sealed class ApiBodyArray : ApiBodyNode
{
    public required List<ApiBodyNode> Items { get; init; }
}

public enum ApiBodyLiteralKind { String, Number, Boolean, Null }

// Kind says which of the value properties is set (it cannot be inferred: "no value" would look like a literal null).
public sealed class ApiBodyLiteral : ApiBodyNode
{
    public required ApiBodyLiteralKind Kind { get; init; }
    public string? StringValue { get; init; }
    public double? NumberValue { get; init; }
    public bool? BoolValue { get; init; }
}

public sealed class ApiBodyVariable : ApiBodyNode
{
    // Checked against ApiConfig.Parameters in ScrapingPlanValidator.
    public required string ParameterName { get; init; }

    // Parameter values are strings; this converts to a typed value for strict APIs (GraphQL variables). Best
    // effort: an unparsable value stays a string.
    public ApiBodyLiteralKind? CoerceTo { get; init; }
}
