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
    // GET or POST (enforced in ScrapingPlanValidator) — POST/GraphQL request
    // bodies (Issue #55). DiscoverySource's own Method stays GET-only,
    // unchanged: a discovery endpoint's own request is not in scope here.
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

    // Request-body tree (Issue #55). Requires Method == "POST" (a bodyless
    // POST is still valid; a GET with a Body is rejected, enforced in
    // ScrapingPlanValidator). Fully orthogonal to the flat-vs-tree response
    // shape above — a GraphQL body is just an ordinary ApiBodyObject whose
    // "query"/"variables" keys are handled by the same generic
    // fixed/variable-value machinery as any other POST body, see
    // ApiBodyNode.
    public ApiBodyNode? Body { get; init; }

    // Embedded-JSON source (Issue #136): an alternative to a live JSON API
    // call, for sites that render their complete data into the initial page
    // HTML (Next.js's __NEXT_DATA__, Nuxt's __NUXT__, or a generic
    // <script type="application/json"> state blob) and hydrate the DOM from
    // it client-side, with no separate, capturable network request ever
    // happening. When set, UrlTemplate/Parameters/Headers still describe an
    // ordinary (optionally parameterized) GET request — but the "response
    // body" to run ItemsPath/Fields/Groups against is the text content of
    // one <script> tag within the fetched page's HTML, not the HTTP
    // response body itself. Mutually exclusive with Body/Method=="POST" (a
    // page load has no request body, enforced in ScrapingPlanValidator);
    // orthogonal to the flat-vs-tree response shape, which still describes
    // the shape of whatever JSON the script tag contains.
    public EmbeddedJsonSource? EmbeddedJsonSource { get; init; }

    // Token/auth bootstrap (Issue #220): one extra request the generated
    // script sends once at the start of every run, before any parameter is
    // resolved, extracting a single short-lived value (a bearer token, a
    // signed URL parameter, a nonce) from its JSON response. That value is
    // then referenceable as "{<Bootstrap.Name>}" wherever a parameter
    // placeholder already is — UrlTemplate, a DiscoverySource/
    // BrowserDiscoverySource template (Issue #217), an ApiBodyVariable's
    // ParameterName — plus an ApiHeader.Template (e.g. "Bearer {token}").
    // Deliberately *not* modeled as an ApiParameter/ApiParameterSource:
    // parameter values become output columns (flat shape) and are printed
    // in "Skipped (404)" lines, and a live credential must never end up in
    // either. Null = no bootstrap, byte-for-byte today's behavior.
    public ApiBootstrap? Bootstrap { get; init; }
}

// See ApiConfig.Bootstrap. A narrower, purpose-built shape than ApiConfig
// itself (Issue #220's own open question): a token endpoint needs no
// parameters/response tree, just one request and one JSON path — and its
// body, when it has one, is a flat set of credential fields (a JSON object,
// or an OAuth2-style form-encoded body), never a deep GraphQL-like tree.
public sealed class ApiBootstrap
{
    // The placeholder name the extracted value is referenced by, e.g.
    // "token" for "{token}". Must not collide with a parameter name.
    public required string Name { get; init; }

    public string Method { get; init; } = "GET";

    // Absolute http(s) URL — fully static, since the bootstrap runs before
    // any parameter is resolved and so can't reference one.
    public required string Url { get; init; }

    // Same Value/EnvironmentVariableName shape as the main request's own
    // headers (a Template header makes no sense here — the value it would
    // reference is exactly what this request is producing).
    public List<ApiHeader>? Headers { get; init; }

    // POST only. Each field is either a literal Value or an
    // EnvironmentVariableName (a credential), mirroring ApiHeader/FillStep:
    // a credential is never embedded literally in the generated script.
    public List<ApiBootstrapBodyField>? BodyFields { get; init; }

    public ApiBootstrapBodyEncoding BodyEncoding { get; init; } = ApiBootstrapBodyEncoding.Json;

    // JSON path (same minimal dot/[*]/[n] DSL as ItemsPath/ApiField.Path)
    // to the value within the bootstrap response, e.g. "access_token" or
    // "data.auth.token".
    public required string ValuePath { get; init; }
}

public sealed class ApiBootstrapBodyField
{
    public required string Name { get; init; }
    public string? Value { get; init; }
    public string? EnvironmentVariableName { get; init; }
}

// Json: sent as a JSON object (requests' json=...). Form: sent
// application/x-www-form-urlencoded (requests' data=...), the encoding an
// OAuth2 client_credentials/password token endpoint expects.
public enum ApiBootstrapBodyEncoding { Json, Form }

// See ApiConfig.EmbeddedJsonSource. A plain optional object, not part of any
// polymorphic list — unlike ApiParameterSource's three variants, there's
// nothing to discriminate between, so no "kind" tag/converter is needed.
public sealed class EmbeddedJsonSource
{
    // CSS selector identifying the <script> tag whose text content is the
    // JSON to parse, e.g. "#__NEXT_DATA__" or
    // "script[type='application/json']" — resolved via BeautifulSoup's
    // select_one at runtime, so subject to the same CSS-selector
    // compatibility caveat as any other selector in this project (see
    // CLAUDE.md's "Selector compatibility" architecture note).
    public required string ScriptSelector { get; init; }
}

// Exactly one of Value/EnvironmentVariableName/Template is set — same "one
// of several optional properties is required, depending on context" shape
// as DataFieldNode.Attribute (there gated by Mode, here just by which one
// is non-null). A header sourced from an environment variable (e.g. an auth
// token) is never embedded literally in the generated script, analogous to
// FillStep.
public sealed class ApiHeader
{
    public required string Name { get; init; }
    public string? Value { get; init; }
    public string? EnvironmentVariableName { get; init; }

    // Issue #220: a header value built at runtime from ApiConfig.Bootstrap's
    // freshly fetched value, e.g. "Bearer {token}" — the only placeholder a
    // template may reference is Bootstrap.Name (validated in
    // ScrapingPlanValidator), so a literal "{" elsewhere in an ordinary
    // Value header is never at risk of being misread as a placeholder.
    public string? Template { get; init; }
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
[JsonDerivedType(typeof(BrowserDiscoverySource), "browserDiscovery")]
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
//
// UrlTemplate may itself reference an earlier-declared parameter's own
// value via the same "{name}" placeholder syntax ApiConfig.UrlTemplate
// already uses (Issue #217) — e.g. a category-scoped discovery endpoint
// like ".../categories/{category}/weeks" that only returns the right weeks
// once {category} is substituted with that parameter's own
// already-resolved value. Declaration order defines dependency order (a
// strict chain, not a full dependency graph, per this issue's own
// deliberately simpler scope) — ScrapingPlanValidator's
// ValidateParameterDependencyOrder rejects a reference to the same or a
// later-declared parameter. Directly resolves Architecture Decision #5's
// long-documented "no dependencies between parameters" limitation.
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

// Issue #216: values a {name} placeholder can take aren't always exposable
// via a single discoverable endpoint (DiscoverySource) or a computable range
// (RangeSource) — some target sites only ever reveal them by actually
// rendering the page and letting lazy-loading/pagination/search trigger the
// value-specific requests themselves (e.g. penny.de/angebote: scrolling
// triggers one .../by-category/{category}/{week} request per category, and
// the set of categories isn't known any other way). Resolved fresh on every
// script run via a dedicated Playwright session, the same "runtime, not
// frozen at generate-time" category DiscoverySource already belongs to.
//
// Deliberately carries no URL-match-pattern field of its own: the requests
// expected to fire during discovery are expected to match the *same*
// ApiConfig.UrlTemplate the main request already uses (that's the whole
// point — discovery observes the real calls the main request will later
// make itself), so the runtime matches captured request URLs against
// UrlTemplate directly, treating this parameter's own {name} placeholder as
// the value to harvest and every *other* {name} placeholder as free to
// differ — the exact same semantics findUrlTemplateMatches
// (popup/api-config.js) already implements at configuration time for the
// identical "which other recorded requests are the same endpoint, different
// value" question. See ScrapingPlanValidator's own check that this
// parameter's name actually appears in UrlTemplate — without that there
// would be nothing to match captured requests against.
//
// Actions reuses BrowserAction (the same WaitFor/Fill/Click/Scroll wire type
// ScrapingConfig.BrowserActions already uses for login flows) rather than a
// Scroll-only shape — real sites may need more than scrolling to reveal the
// lazy-loaded requests (typing into a search box, clicking through
// pagination), and a bespoke per-interaction-kind source variant would be
// exactly the one-off duplication problem Issue #221's future "preparation
// phase" IR concept exists to avoid. Null/empty = just load DiscoveryUrl and
// observe whatever requests fire natively, no interaction needed.
public sealed class BrowserDiscoverySource : ApiParameterSource
{
    // May itself reference an earlier-declared parameter's own value via a
    // "{name}" placeholder, same as DiscoverySource.UrlTemplate above
    // (Issue #217) — substituted with that parameter's already-resolved
    // value before the throwaway Playwright session navigates to it.
    public required string DiscoveryUrl { get; init; }
    public List<BrowserAction>? Actions { get; init; }
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
    // "meta.price". See ScrapingField.Selector — same "blank iff derived
    // from a combineFields/splitField transform" relaxation (Issue #206
    // follow-up).
    public string? Path { get; init; }

    // See ExtractStep.Transforms (Issue #84) — same meaning, applied to
    // whatever value Path resolves to (already string-coerced by the
    // runtime's JSON-path resolver before the chain runs).
    public List<FieldTransform>? Transforms { get; init; }

    // See ScrapingField.HiddenFromOutput.
    public bool HiddenFromOutput { get; init; }
}
