using System.Text;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Serializes an ApiConfig into Python source: a handful of module-level
// constants (FIELDS/PARAMETERS/HEADERS) that scraper_api.py.j2 embeds
// verbatim. Same rationale as PythonGroupTreeLiteral: ApiParameterSource has
// three shapes (StaticListSource/DiscoverySource/RangeSource) with no common
// structure for Scriban to loop over generically, so the dict-of-dicts shape
// is built here in C#, and the template's runtime code only needs to switch
// on a "kind" string identical to the wire format's JSON discriminator (see
// ApiConfig.cs's [JsonPolymorphic] attribute).
internal static class PythonApiConfigLiteral
{
    public static string RenderFields(List<ApiField> fields) =>
        RenderList(fields, RenderField);

    // Serializes ApiConfig.Groups (Issue #54's tree shape) the same way
    // PythonGroupTreeLiteral serializes Container-Mode's GroupNode tree:
    // a nested list-of-dicts literal that scraper_api_grouped.py.j2's
    // _extract_api_group() walks at runtime, using presence of the
    // "children" key as the group-vs-field discriminator (mirroring
    // ApiNodeJsonConverter's own structural discriminator on the wire).
    public static string RenderGroups(IReadOnlyList<ApiGroup> groups, int indent = 0) =>
        RenderNodes(groups, indent);

    private static string RenderNodes(IReadOnlyList<ApiNode> nodes, int indent)
    {
        if (nodes.Count == 0)
            return "[]";

        var pad = new string(' ', indent);
        var childPad = new string(' ', indent + 4);
        var sb = new StringBuilder();
        sb.Append("[\n");
        foreach (var node in nodes)
            sb.Append(childPad).Append(RenderNode(node, indent + 4)).Append(",\n");
        sb.Append(pad).Append(']');
        return sb.ToString();
    }

    private static string RenderNode(ApiNode node, int indent) => node switch
    {
        ApiGroup group => RenderGroup(group, indent),
        ApiField field => RenderField(field),
        _ => throw new InvalidOperationException($"Unknown Api node type: {node.GetType()}"),
    };

    private static string RenderGroup(ApiGroup group, int indent)
    {
        var children = RenderNodes(group.Children, indent);
        return $$"""{"name": {{PythonLiteral.Str(group.Name)}}, "path": {{PythonLiteral.Str(group.Path)}}, "children": {{children}}}""";
    }

    // Always includes "transform" (Issue #84) and "hiddenFromOutput" (Issue
    // #206 follow-up), even when empty/False — used by both the flat
    // RenderFields (FIELDS constant) and the tree shape's RenderNode above,
    // so _resolve_field/_extract_api_group can apply them uniformly via a
    // plain node.get(...) either way. "path" is "" (never None) when blank —
    // a derived (combineFields/splitField) field's own path is never read
    // at runtime (see _resolve_field's/_extract_api_group's "if path:"
    // guard).
    private static string RenderField(ApiField field) =>
        $$"""{"name": {{PythonLiteral.Str(field.Name)}}, "path": {{PythonLiteral.Str(field.Path ?? "")}}, "transform": {{PythonFieldTransformLiteral.Render(field.Transforms)}}, "hiddenFromOutput": {{(field.HiddenFromOutput ? "True" : "False")}}}""";

    // See PythonGroupTreeLiteral.CollectHiddenFieldNames — same "global by
    // name" tree walk, used to build scraper_api_grouped.py.j2's own
    // HIDDEN_FIELD_NAMES set.
    public static IReadOnlyList<string> CollectHiddenFieldNames(IReadOnlyList<ApiNode> nodes) => nodes.SelectMany(node => node switch
    {
        ApiField { HiddenFromOutput: true } field => new[] { field.Name },
        ApiField => Array.Empty<string>(),
        ApiGroup group => CollectHiddenFieldNames(group.Children),
        _ => Array.Empty<string>(),
    }).ToList();

    // Serializes ApiConfig.Body (Issue #55's request-body tree) into the
    // same kind of dict-of-dicts literal RenderGroups already builds for the
    // response-extraction tree — the runtime's _render_body (Phase B3) reads
    // it back using the same "which key is present" discriminator this
    // codebase already uses everywhere a JsonConverter sniffs structurally
    // (ContainerNodeJsonConverter, ApiNodeJsonConverter, ApiBodyNodeJsonConverter).
    // "None" (Python's null) for an absent Body — a bodyless GET/POST.
    public static string RenderBody(ApiBodyNode? body) => body is null ? "None" : RenderBodyNode(body);

    private static string RenderBodyNode(ApiBodyNode node) => node switch
    {
        ApiBodyObject obj => RenderBodyObject(obj),
        ApiBodyArray array => RenderBodyArray(array),
        ApiBodyVariable variable => RenderBodyVariable(variable),
        ApiBodyLiteral literal => RenderBodyLiteral(literal),
        _ => throw new InvalidOperationException($"Unknown ApiBodyNode type: {node.GetType()}"),
    };

    private static string RenderBodyObject(ApiBodyObject obj)
    {
        var entries = obj.Properties.Select(property => $$"""{{PythonLiteral.Str(property.Key)}}: {{RenderBodyNode(property.Value)}}""");
        return "{\"properties\": {" + string.Join(", ", entries) + "}}";
    }

    private static string RenderBodyArray(ApiBodyArray array) =>
        $$"""{"items": [{{string.Join(", ", array.Items.Select(RenderBodyNode))}}]}""";

    private static string RenderBodyVariable(ApiBodyVariable variable) => variable.CoerceTo is { } coerceTo
        ? $$"""{"parameterName": {{PythonLiteral.Str(variable.ParameterName)}}, "coerceTo": {{PythonLiteral.Str(coerceTo.ToString())}}}"""
        : $$"""{"parameterName": {{PythonLiteral.Str(variable.ParameterName)}}}""";

    // "value" is omitted entirely for Null (mirrors RenderFormatSuffix's
    // "omit rather than send a meaningless default" pattern above) — the
    // runtime's _render_body never looks at it for kind == "Null" either.
    private static string RenderBodyLiteral(ApiBodyLiteral literal) => literal.Kind switch
    {
        ApiBodyLiteralKind.String => $$"""{"kind": "String", "value": {{PythonLiteral.Str(literal.StringValue!)}}}""",
        ApiBodyLiteralKind.Number => $$"""{"kind": "Number", "value": {{PythonLiteral.Num(literal.NumberValue!.Value)}}}""",
        ApiBodyLiteralKind.Boolean => $$"""{"kind": "Boolean", "value": {{(literal.BoolValue!.Value ? "True" : "False")}}}""",
        ApiBodyLiteralKind.Null => """{"kind": "Null"}""",
        _ => throw new InvalidOperationException($"Unknown ApiBodyLiteralKind: {literal.Kind}"),
    };

    // Issue #136: "None" (Python's null) when no EmbeddedJsonSource is set —
    // the runtime's _extract_embedded_json helper is only called when this
    // constant isn't None, mirroring RenderBody's own "None means absent"
    // convention above.
    public static string RenderEmbeddedJsonSource(EmbeddedJsonSource? source) => source is null
        ? "None"
        : $$"""{"scriptSelector": {{PythonLiteral.Str(source.ScriptSelector)}}}""";

    public static string RenderParameters(List<ApiParameter> parameters) =>
        RenderList(parameters, parameter =>
            $$"""{"name": {{PythonLiteral.Str(parameter.Name)}}, "source": {{RenderSource(parameter.Source)}}}""");

    public static string RenderHeaders(List<ApiHeader>? headers) =>
        headers is null ? "[]" : RenderList(headers, RenderHeader);

    // Mirrors ScrapingPlanValidator.ValidateApiHeaders's "meaningful" check
    // (IsNullOrWhiteSpace, not just != null) — an empty-string
    // EnvironmentVariableName alongside a set Value passes validation as "Value
    // wins" there, so codegen has to agree on which one is actually set.
    // Issue #220: a Template header renders as {"name", "template"} —
    // _build_headers() substitutes the bootstrap value into it at runtime.
    private static string RenderHeader(ApiHeader header) =>
        !string.IsNullOrWhiteSpace(header.EnvironmentVariableName)
            ? $$"""{"name": {{PythonLiteral.Str(header.Name)}}, "envVar": {{PythonLiteral.Str(header.EnvironmentVariableName)}}}"""
            : !string.IsNullOrWhiteSpace(header.Template)
                ? $$"""{"name": {{PythonLiteral.Str(header.Name)}}, "template": {{PythonLiteral.Str(header.Template!)}}}"""
                : $$"""{"name": {{PythonLiteral.Str(header.Name)}}, "value": {{PythonLiteral.Str(header.Value!)}}}""";

    // Issue #220: "None" when no bootstrap is configured, same "None means
    // absent" convention as RenderBody/RenderEmbeddedJsonSource. Body fields
    // reuse the header dict shape ({"name", "value"|"envVar"}) so the
    // runtime resolves both through one helper (_resolve_bootstrap_pairs).
    public static string RenderBootstrap(ApiBootstrap? bootstrap) => bootstrap is null
        ? "None"
        : $$"""{"name": {{PythonLiteral.Str(bootstrap.Name)}}, "method": {{PythonLiteral.Str(bootstrap.Method)}}, "url": {{PythonLiteral.Str(bootstrap.Url)}}, "headers": {{RenderHeaders(bootstrap.Headers)}}, "bodyFields": {{RenderBootstrapBodyFields(bootstrap.BodyFields)}}, "bodyEncoding": {{PythonLiteral.Str(bootstrap.BodyEncoding.ToString())}}, "valuePath": {{PythonLiteral.Str(bootstrap.ValuePath)}}}""";

    private static string RenderBootstrapBodyFields(List<ApiBootstrapBodyField>? fields) =>
        fields is null ? "[]" : RenderList(fields, field => !string.IsNullOrWhiteSpace(field.EnvironmentVariableName)
            ? $$"""{"name": {{PythonLiteral.Str(field.Name)}}, "envVar": {{PythonLiteral.Str(field.EnvironmentVariableName)}}}"""
            : $$"""{"name": {{PythonLiteral.Str(field.Name)}}, "value": {{PythonLiteral.Str(field.Value ?? "")}}}""");

    private static string RenderSource(ApiParameterSource source) => source switch
    {
        StaticListSource s => $$"""{"kind": "staticList", "values": [{{string.Join(", ", s.Values.Select(PythonLiteral.Str))}}]}""",
        DiscoverySource d => $$"""{"kind": "discovery", "urlTemplate": {{PythonLiteral.Str(d.UrlTemplate)}}, "itemsPath": {{PythonLiteral.Str(d.ItemsPath)}}, "valuePath": {{PythonLiteral.Str(d.ValuePath)}}}""",
        // "format" is omitted when unset (rather than sending the resolved
        // default) so the runtime's own RangeFormat.Resolve-equivalent
        // (_resolve_parameter_values's `source.get("format")` fallback in
        // scraper_api.py.j2) stays the single source of truth for defaults.
        RangeSource r => $$"""{"kind": "range", "type": {{PythonLiteral.Str(r.Type.ToString())}}, "from": {{PythonLiteral.Str(r.From)}}, "to": {{PythonLiteral.Str(r.To)}}{{RenderFormatSuffix(r.Format)}}}""",
        // Issue #216: Actions is rendered as a runtime-interpreted
        // list-of-dicts (see RenderBrowserActions), not baked as literal
        // Playwright code the way the top-level login action sequence
        // already is (PythonPlaywrightCodeGenerator) — this list can occur
        // once per parameter, so a generic runtime dispatcher (see
        // _run_browser_action in scraper_api.py.j2) scales better than one
        // bespoke generated function per discovery source.
        BrowserDiscoverySource b => $$"""{"kind": "browserDiscovery", "discoveryUrl": {{PythonLiteral.Str(b.DiscoveryUrl)}}, "actions": {{RenderBrowserActions(b.Actions)}}}""",
        _ => throw new InvalidOperationException($"Unknown ApiParameterSource type: {source.GetType()}"),
    };

    private static string RenderFormatSuffix(string? format) =>
        format is null ? "" : $$""", "format": {{PythonLiteral.Str(format)}}""";

    // Issue #216: serializes BrowserDiscoverySource.Actions the same
    // camelCase-key-matches-the-wire-JSON convention every other dict this
    // class builds already uses (unlike PythonGroupTreeLiteral's own
    // snake_case "frame_path", a one-off for that specific tree walker) —
    // _run_browser_action/_run_scroll_action in scraper_api.py.j2 read these
    // keys directly. FramePath is omitted entirely when unset, same
    // "absent key = no FramePath" convention PythonGroupTreeLiteral's
    // FramePathPart already established.
    private static string RenderBrowserActions(List<BrowserAction>? actions) =>
        actions is null ? "[]" : RenderList(actions, RenderBrowserAction);

    private static string RenderBrowserAction(BrowserAction action) => action switch
    {
        WaitForAction a => $$"""{"kind": "waitFor", "selector": {{PythonLiteral.Str(a.Selector)}}, "timeoutMs": {{a.TimeoutMs}}{{FramePathSuffix(a.FramePath)}}}""",
        FillAction a => $$"""{"kind": "fill", "selector": {{PythonLiteral.Str(a.Selector)}}, "environmentVariableName": {{PythonLiteral.Str(a.EnvironmentVariableName)}}{{FramePathSuffix(a.FramePath)}}}""",
        ClickAction a => $$"""{"kind": "click", "selector": {{PythonLiteral.Str(a.Selector)}}{{FramePathSuffix(a.FramePath)}}}""",
        // Issue #289: "scrollStepPx" omitted entirely when unset — None is
        // the runtime's own "jump straight to the bottom" default (see
        // _run_scroll_action in scraper_api.py.j2), same "absent key = no
        // override" convention FramePath already uses.
        ScrollAction a => $$"""{"kind": "scroll", "containerSelector": {{(a.ContainerSelector is null ? "None" : PythonLiteral.Str(a.ContainerSelector))}}, "loadMoreButtonSelector": {{(a.LoadMoreButtonSelector is null ? "None" : PythonLiteral.Str(a.LoadMoreButtonSelector))}}, "maxIterations": {{a.MaxIterations}}, "waitAfterMs": {{a.WaitAfterMs}}{{(a.ScrollStepPx is { } stepPx ? $""", "scrollStepPx": {stepPx}""" : "")}}{{FramePathSuffix(a.FramePath)}}}""",
        _ => throw new InvalidOperationException($"Unknown BrowserAction type: {action.GetType()}"),
    };

    private static string FramePathSuffix(List<string>? framePath) =>
        framePath is { Count: > 0 } ? $$""", "framePath": {{PythonLiteral.StrList(framePath)}}""" : "";

    private static string RenderList<T>(List<T> items, Func<T, string> renderItem) =>
        "[" + string.Join(", ", items.Select(renderItem)) + "]";
}
