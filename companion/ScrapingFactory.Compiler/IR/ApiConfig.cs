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

    // JSON path to the array of records within the response body — minimal
    // dot/[*]/[n] notation (full JSON-path DSL comes with Phase 2's codegen
    // and its runtime counterpart).
    public required string ItemsPath { get; init; }

    public List<ApiField> Fields { get; init; } = [];
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

public sealed class ApiField
{
    public required string Name { get; init; }

    // Minimal JSON-path notation relative to one ItemsPath record, e.g.
    // "title" or "meta.price".
    public required string Path { get; init; }
}
