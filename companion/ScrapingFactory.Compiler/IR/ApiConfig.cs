using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// API-Mode (Issue #53, Phase 1): a third alternative to Fields/Groups —
// instead of scraping rendered HTML, calls a JSON API endpoint directly and
// extracts fields from the response body. Mutually exclusive with
// Fields/Groups (enforced in the /generate endpoint). When set,
// OutputFormat is forced to Csv and Engine to ScrapingEngine.Api
// server-side, regardless of what the wire payload set them to — see
// ScrapingPlanBuilder.
public sealed class ApiConfig
{
    // Only GET is supported for now (enforced in ScrapingPlanValidator) —
    // POST/GraphQL request bodies are deliberately out of scope for this
    // phase, see follow-up issue #55.
    public string Method { get; init; } = "GET";

    // e.g. "https://example.com/api/items?category={category}&week={week}"
    // — every {name} placeholder must have a matching Parameters entry, and
    // vice versa (checked in ScrapingPlanValidator).
    public required string UrlTemplate { get; init; }

    public List<ApiHeader>? Headers { get; init; }

    public List<ApiParameter> Parameters { get; init; } = [];

    // Flat shape (Issue #53, Phase 1): JSON path to the array of records
    // within the response body — minimal dot/[*]/[n] notation — plus one
    // flat ApiField per extracted value, relative to one record. Exactly
    // one repetition level. Mutually exclusive with Groups below; both
    // null, or both set (enforced in ScrapingPlanValidator). Nullable
    // (rather than the original `required`) since Issue #54's tree shape
    // is now an alternative, not a replacement — see Groups.
    public string? ItemsPath { get; init; }
    public List<ApiField>? Fields { get; init; }

    // Tree shape (Issue #54): an arbitrarily deep alternative to
    // ItemsPath/Fields for responses that nest more than one repetition
    // level (arrays of arrays, or objects with their own nested arrays).
    // Mutually exclusive with ItemsPath/Fields. A single root ApiGroup with
    // Path == the old ItemsPath and one ApiField child per old Fields entry
    // is exactly equivalent to the flat shape. Forces OutputFormat.Xml
    // instead of Csv when set (see ScrapingPlanBuilder) — the same way
    // ScrapingConfig.Groups forces Xml for Container-Mode, since tree data
    // (unlike a flat record list) doesn't fit CSV's column model.
    public List<ApiGroup>? Groups { get; init; }
}

// Exactly one of Value/EnvironmentVariableName is set — same "one of two
// optional properties is required, depending on context" shape as
// DataFieldNode.Attribute (there gated by Mode, here just by which one is
// non-null). A header sourced from an environment variable (e.g. an auth
// token) is never embedded literally in the generated script, analogous to
// FillStep.
public sealed class ApiHeader
{
    public required string Name { get; init; }
    public string? Value { get; init; }
    public string? EnvironmentVariableName { get; init; }
}

public sealed class ApiParameter
{
    public required string Name { get; init; }
    public required ApiParameterSource Source { get; init; }
}

// Three ways to enumerate the values a {name} placeholder takes across the
// requests the generated script makes — see issue #53's "Werte-Quelle"
// concept. Discriminated on the wire by an explicit "kind" property via
// System.Text.Json's built-in polymorphism support rather than a
// hand-rolled converter like ContainerNodeJsonConverter: unlike
// GroupNode/DataFieldNode, these three variants have no natural structural
// tell to sniff, so a real discriminator is the simpler option here.
[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(StaticListSource), "staticList")]
[JsonDerivedType(typeof(DiscoverySource), "discovery")]
[JsonDerivedType(typeof(RangeSource), "range")]
public abstract class ApiParameterSource
{
}

// Simplest fallback: values entered manually by the user.
public sealed class StaticListSource : ApiParameterSource
{
    public required List<string> Values { get; init; }
}

// A second endpoint, found via the same record-and-correlate technique used
// for the main request, that returns the valid values itself — solves the
// "stale/newly added values" problem a StaticListSource would have (e.g.
// newly added categories) by re-resolving values at script runtime instead
// of freezing them at configuration time.
public sealed class DiscoverySource : ApiParameterSource
{
    public string Method { get; init; } = "GET";
    public required string UrlTemplate { get; init; }
    public required string ItemsPath { get; init; }
    public required string ValuePath { get; init; }
}

// Purely locally computable, e.g. "last N weeks up to today" — no request
// needed. From/To are strings rather than typed values because their
// meaning depends on Type (an ISO week string, a number, a date), and To
// additionally needs to represent a dynamic marker like "today".
public sealed class RangeSource : ApiParameterSource
{
    public required RangeType Type { get; init; }
    public required string From { get; init; }
    public required string To { get; init; }

    // Only meaningful for IsoWeek/Date (Number is plain integers, no
    // template). Null falls back to RangeFormat's hardcoded default per
    // Type — kept optional rather than required so existing persisted
    // configs and direct API callers from before this field existed keep
    // working unchanged. Same "{token}" mini-syntax as UrlTemplate's
    // "{name}" placeholders, used for both parsing From/To *and* rendering
    // each expanded value, so the two can never drift apart the way a
    // hardcoded parser and a target site's own URL convention just did
    // (bug: a site using "2026-35" instead of ISO-8601 "2026-W35" crashed
    // the generated script) — see RangeFormat.
    public string? Format { get; init; }
}

public enum RangeType { IsoWeek, Number, Date }

// API-Mode's JSON-path tree (Issue #54), parallel to ContainerNode's
// CSS-selector tree: an ApiGroup scopes its children to whatever its own
// Path resolves to (one instance if that's an object/scalar, N instances if
// it's a JSON array), ApiField is the leaf that actually extracts a value
// from within that scope. See ApiConfig.Groups/ApiCallStep.
public abstract class ApiNode
{
    public required string Name { get; init; }
}

public sealed class ApiGroup : ApiNode
{
    // Relative to the parent scope: the whole parsed response body for a
    // root group, or one already-matched instance of the parent group's own
    // resolved value for a nested one — same "relative to parent scope"
    // convention GroupNode.Selector uses for CSS. May be "" to mean
    // "operate directly on the parent scope itself", needed to express two
    // directly-nested repeating levels with no object key between them (a
    // raw array-of-arrays).
    public required string Path { get; init; }

    public required List<ApiNode> Children { get; init; }

    // Deliberately no Repeating flag, unlike GroupNode.Repeating: whether a
    // CSS selector matches once or N times is a transient runtime fact
    // (GroupNode.Repeating is chosen explicitly by the user, never inferred
    // from match count, since a page's DOM could change from run to run).
    // Whether resolving a JSON path yields an array or an object/scalar has
    // no such ambiguity — it's a structural property of the API's schema,
    // stable across requests — so repeating-ness is simply inferred at
    // runtime from whatever Path resolves to.
}

public sealed class ApiField : ApiNode
{
    // Minimal JSON-path notation relative to the parent scope — one
    // ItemsPath record in the flat shape (Issue #53), or one ApiGroup
    // instance in the tree shape (Issue #54) — e.g. "title" or
    // "meta.price".
    public required string Path { get; init; }
}
