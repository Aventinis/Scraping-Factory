using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// API mode: calls a JSON endpoint instead of scraping HTML. Exclusive with Fields/Groups; forces Engine.Api.
// Response shape is either flat (ItemsPath + Fields) or a tree (Groups); behavior: docs/design-notes/compiler.md.
public sealed class ApiConfig
{
    // GET or POST.
    public string Method { get; init; } = "GET";

    // e.g. "https://example.com/api/items?category={category}"; every {name} needs a Parameters entry and vice versa.
    public required string UrlTemplate { get; init; }

    public List<ApiHeader>? Headers { get; init; }
    public List<ApiParameter> Parameters { get; init; } = [];

    // Flat shape: JSON path to the array of records, one ApiField per value. Exclusive with Groups.
    public string? ItemsPath { get; init; }
    public List<ApiField>? Fields { get; init; }

    // Tree shape for responses with more than one repetition level; defaults the output to Xml.
    public List<ApiGroup>? Groups { get; init; }

    // Request body tree; requires Method == "POST". A GraphQL body is an ordinary body.
    public ApiBodyNode? Body { get; init; }

    // The JSON comes from a <script> tag of the fetched page instead of the response body; GET only.
    public EmbeddedJsonSource? EmbeddedJsonSource { get; init; }

    // One request at the start of every run yielding a short-lived value, referenced as "{<Name>}" in URLs and
    // header templates. Deliberately not a parameter: parameter values become output columns.
    public ApiBootstrap? Bootstrap { get; init; }

    // The next page's cursor is in the current response; every parameter combination runs its own chain.
    public ApiCursorPagination? CursorPagination { get; init; }

    // The next page is in the `Link: <...>; rel="next"` header; exclusive with CursorPagination.
    public ApiLinkHeaderPagination? LinkHeaderPagination { get; init; }
}

public sealed class ApiLinkHeaderPagination
{
    // Safety cap per parameter combination.
    public int MaxPages { get; init; } = 50;
}

// Page 1 is sent as configured; from page 2 on the previous page's cursor is placed at Target.
public sealed class ApiCursorPagination
{
    // JSON path of the next cursor in the response; missing, null or empty ends the chain.
    public required string NextCursorPath { get; init; }

    // Optional "has more pages" path; false/0/"false" ends the chain even if a cursor is present.
    public string? HasNextPagePath { get; init; }

    public ApiCursorTarget Target { get; init; } = ApiCursorTarget.Query;

    // Target == Query: the query parameter replaced/appended.
    public string? QueryParameterName { get; init; }

    // Target == Body: dot path in the JSON body, e.g. "variables.after"; requires POST.
    public string? BodyPath { get; init; }

    public int MaxPages { get; init; } = 50;
}

public enum ApiCursorTarget { Query, Body }

// A narrower shape than ApiConfig on purpose: one request, one JSON path, a flat credential body.
public sealed class ApiBootstrap
{
    // The placeholder name, e.g. "token" for "{token}"; must not collide with a parameter name.
    public required string Name { get; init; }

    public string Method { get; init; } = "GET";

    // Absolute and fully static: it runs before any parameter is resolved.
    public required string Url { get; init; }

    // No Template here: the value it would reference is what this request produces.
    public List<ApiHeader>? Headers { get; init; }

    // POST only. A credential is an EnvironmentVariableName, never a literal in the script.
    public List<ApiBootstrapBodyField>? BodyFields { get; init; }

    public ApiBootstrapBodyEncoding BodyEncoding { get; init; } = ApiBootstrapBodyEncoding.Json;

    // JSON path of the value in the bootstrap response, e.g. "access_token".
    public required string ValuePath { get; init; }
}

public sealed class ApiBootstrapBodyField
{
    public required string Name { get; init; }
    public string? Value { get; init; }
    public string? EnvironmentVariableName { get; init; }
}

// Json: json=...; Form: application/x-www-form-urlencoded (an OAuth2 token endpoint).
public enum ApiBootstrapBodyEncoding { Json, Form }

public sealed class EmbeddedJsonSource
{
    // CSS selector of the <script> tag, resolved with BeautifulSoup's select_one.
    public required string ScriptSelector { get; init; }
}

// Exactly one of Value / EnvironmentVariableName / Template is set.
public sealed class ApiHeader
{
    public required string Name { get; init; }
    public string? Value { get; init; }

    // Read at run time, never embedded in the script.
    public string? EnvironmentVariableName { get; init; }

    // Built from the bootstrap value, e.g. "Bearer {token}"; the only placeholder allowed is Bootstrap.Name.
    public string? Template { get; init; }
}

public sealed class ApiParameter
{
    public required string Name { get; init; }
    public required ApiParameterSource Source { get; init; }
}

// The ways to enumerate the values a {name} placeholder takes. An explicit "kind" tag, because the variants have
// no structural tell (unlike GroupNode/DataFieldNode).
[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(StaticListSource), "staticList")]
[JsonDerivedType(typeof(DiscoverySource), "discovery")]
[JsonDerivedType(typeof(RangeSource), "range")]
[JsonDerivedType(typeof(BrowserDiscoverySource), "browserDiscovery")]
public abstract class ApiParameterSource
{
}

public sealed class StaticListSource : ApiParameterSource
{
    public required List<string> Values { get; init; }
}

// A second endpoint that returns the values, resolved at run time. UrlTemplate may reference an earlier-declared
// parameter via {name} (a strict chain: declaration order is dependency order).
public sealed class DiscoverySource : ApiParameterSource
{
    public string Method { get; init; } = "GET";
    public required string UrlTemplate { get; init; }
    public required string ItemsPath { get; init; }
    public required string ValuePath { get; init; }
}

// Computed locally. From/To are strings because their meaning depends on Type; To may be "today".
public sealed class RangeSource : ApiParameterSource
{
    public required RangeType Type { get; init; }
    public required string From { get; init; }
    public required string To { get; init; }

    // IsoWeek/Date only; the "{yyyy}/{ww}/{mm}/{dd}" template used to parse From/To and to render every value.
    // Null = the ISO default per type (see RangeFormat).
    public string? Format { get; init; }
}

// Values that only appear when the page is rendered: a throwaway Playwright session loads DiscoveryUrl, runs
// Actions and harvests the values from the requests that match the main UrlTemplate (so this parameter's
// {name} must occur in it). Reuses BrowserAction instead of a scroll-only shape.
public sealed class BrowserDiscoverySource : ApiParameterSource
{
    // May reference an earlier-declared parameter via {name}.
    public required string DiscoveryUrl { get; init; }

    // Null/empty = just load the page.
    public List<BrowserAction>? Actions { get; init; }
}

public enum RangeType { IsoWeek, Number, Date }

// JSON-path counterpart of ContainerNode: a group scopes its children to what its Path resolves to
// (one instance for an object/scalar, N for an array), a field extracts a value within that scope.
public abstract class ApiNode
{
    public required string Name { get; init; }
}

public sealed class ApiGroup : ApiNode
{
    // Relative to the parent scope (the response body for a root group). "" = the parent scope itself.
    public required string Path { get; init; }

    public required List<ApiNode> Children { get; init; }

    // No Repeating flag on purpose: an array vs. an object is a stable property of the API's schema, so it is
    // inferred at run time.
}

public sealed class ApiField : ApiNode
{
    // Relative to the parent scope, e.g. "title" or "meta.price"; blank only for a derived field.
    public string? Path { get; init; }

    public List<FieldTransform>? Transforms { get; init; }

    public bool HiddenFromOutput { get; init; }
}
