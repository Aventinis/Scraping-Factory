namespace ScrapingFactory.Compiler.IR;

// Request-body construction tree (Issue #55) — the mirror image of
// ApiGroup/ApiField's response-extraction tree (see ApiNode in
// ApiConfig.cs): describes what JSON value to WRITE at this position of the
// outgoing request body, not where to read one FROM an already-received
// response. A leaf is either a fixed literal (ApiBodyLiteral) or a
// reference to one of ApiConfig.Parameters by name (ApiBodyVariable),
// resolved per request from that parameter's Source — reusing the existing
// ApiParameter/ApiParameterSource machinery rather than inventing a second,
// body-specific value-source. See ApiConfig.Body/ApiBodyNodeJsonConverter.
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

// Which of StringValue/NumberValue/BoolValue is actually set is determined
// by Kind (checked in ScrapingPlanValidator) — Kind itself can't be inferred
// structurally from which value property is non-null the way ApiNode's
// Group/Field split can, since e.g. "no value set" would otherwise be
// indistinguishable from a literal null. See
// ApiBodyNodeJsonConverter's doc comment for why Kind stays an explicit tag
// even though the outer ApiBodyNode split is structural.
public sealed class ApiBodyLiteral : ApiBodyNode
{
    public required ApiBodyLiteralKind Kind { get; init; }
    public string? StringValue { get; init; }
    public double? NumberValue { get; init; }
    public bool? BoolValue { get; init; }
}

public sealed class ApiBodyVariable : ApiBodyNode
{
    // Cross-checked against ApiConfig.Parameters in ScrapingPlanValidator —
    // an unknown name is rejected there, not here.
    public required string ParameterName { get; init; }

    // Best-effort: an unparsable resolved value falls back to a plain JSON
    // string at runtime rather than crashing the run (see the Python
    // runtime's _coerce_body_value, Phase B3) — a strictly-typed GraphQL
    // server rejecting a stringified number is a target-site problem this
    // can only mitigate, since every ApiParameterSource value is
    // string-typed end to end.
    public ApiBodyLiteralKind? CoerceTo { get; init; }
}
