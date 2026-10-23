using System.Text;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Serializes an ApiConfig into Python source: module-level constants (FIELDS/PARAMETERS/HEADERS/...) that the API
// templates embed verbatim. Built here as dict-of-dicts because ApiParameterSource has no common structure for
// Scriban to loop over; the runtime switches on the same "kind" string as the wire format.
internal static class PythonApiConfigLiteral
{
    public static string RenderFields(List<ApiField> fields) =>
        RenderList(fields, RenderField);

    // The tree shape as a nested list-of-dicts literal, like PythonGroupTreeLiteral; the runtime tells group from field
    // by the "children" key.
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

    // Always includes "transform" and "hiddenFromOutput", even when empty, so the runtime reads them with a plain
    // node.get(...). "path" is "" (never None) when blank: a derived field's path is never read.
    private static string RenderField(ApiField field) =>
        $$"""{"name": {{PythonLiteral.Str(field.Name)}}, "path": {{PythonLiteral.Str(field.Path ?? "")}}, "transform": {{PythonFieldTransformLiteral.Render(field.Transforms)}}, "hiddenFromOutput": {{(field.HiddenFromOutput ? "True" : "False")}}}""";

    // See PythonGroupTreeLiteral.CollectHiddenFieldNames (feeds HIDDEN_FIELD_NAMES).
    public static IReadOnlyList<string> CollectHiddenFieldNames(IReadOnlyList<ApiNode> nodes) => nodes.SelectMany(node => node switch
    {
        ApiField { HiddenFromOutput: true } field => new[] { field.Name },
        ApiField => Array.Empty<string>(),
        ApiGroup group => CollectHiddenFieldNames(group.Children),
        _ => Array.Empty<string>(),
    }).ToList();

    // The request-body tree as a dict-of-dicts literal read back by the runtime's _render_body. "None" for no body.
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

    // "value" is omitted for Null; the runtime never reads it then.
    private static string RenderBodyLiteral(ApiBodyLiteral literal) => literal.Kind switch
    {
        ApiBodyLiteralKind.String => $$"""{"kind": "String", "value": {{PythonLiteral.Str(literal.StringValue!)}}}""",
        ApiBodyLiteralKind.Number => $$"""{"kind": "Number", "value": {{PythonLiteral.Num(literal.NumberValue!.Value)}}}""",
        ApiBodyLiteralKind.Boolean => $$"""{"kind": "Boolean", "value": {{(literal.BoolValue!.Value ? "True" : "False")}}}""",
        ApiBodyLiteralKind.Null => """{"kind": "Null"}""",
        _ => throw new InvalidOperationException($"Unknown ApiBodyLiteralKind: {literal.Kind}"),
    };

    // "None" when no EmbeddedJsonSource is set (the runtime helper is only called otherwise).
    public static string RenderEmbeddedJsonSource(EmbeddedJsonSource? source) => source is null
        ? "None"
        : $$"""{"scriptSelector": {{PythonLiteral.Str(source.ScriptSelector)}}}""";

    public static string RenderParameters(List<ApiParameter> parameters) =>
        RenderList(parameters, parameter =>
            $$"""{"name": {{PythonLiteral.Str(parameter.Name)}}, "source": {{RenderSource(parameter.Source)}}}""");

    public static string RenderHeaders(List<ApiHeader>? headers) =>
        headers is null ? "[]" : RenderList(headers, RenderHeader);

    // Mirrors ScrapingPlanValidator.ValidateApiHeaders' "meaningful" check (IsNullOrWhiteSpace): an empty env var name
    // next to a set Value means "Value wins", so codegen must agree. A Template header renders as {"name", "template"}.
    private static string RenderHeader(ApiHeader header) =>
        !string.IsNullOrWhiteSpace(header.EnvironmentVariableName)
            ? $$"""{"name": {{PythonLiteral.Str(header.Name)}}, "envVar": {{PythonLiteral.Str(header.EnvironmentVariableName)}}}"""
            : !string.IsNullOrWhiteSpace(header.Template)
                ? $$"""{"name": {{PythonLiteral.Str(header.Name)}}, "template": {{PythonLiteral.Str(header.Template!)}}}"""
                : $$"""{"name": {{PythonLiteral.Str(header.Name)}}, "value": {{PythonLiteral.Str(header.Value!)}}}""";

    // "None" without a bootstrap. Body fields reuse the header dict shape so one runtime helper resolves both.
    public static string RenderBootstrap(ApiBootstrap? bootstrap) => bootstrap is null
        ? "None"
        : $$"""{"name": {{PythonLiteral.Str(bootstrap.Name)}}, "method": {{PythonLiteral.Str(bootstrap.Method)}}, "url": {{PythonLiteral.Str(bootstrap.Url)}}, "headers": {{RenderHeaders(bootstrap.Headers)}}, "bodyFields": {{RenderBootstrapBodyFields(bootstrap.BodyFields)}}, "bodyEncoding": {{PythonLiteral.Str(bootstrap.BodyEncoding.ToString())}}, "valuePath": {{PythonLiteral.Str(bootstrap.ValuePath)}}}""";

    // "None" when absent; only the key of the chosen Target is meaningful at run time, the other is None.
    public static string RenderCursorPagination(ApiCursorPagination? cursor) => cursor is null
        ? "None"
        : $$"""{"nextCursorPath": {{PythonLiteral.Str(cursor.NextCursorPath)}}, "hasNextPagePath": {{(cursor.HasNextPagePath is null ? "None" : PythonLiteral.Str(cursor.HasNextPagePath))}}, "target": {{PythonLiteral.Str(cursor.Target.ToString())}}, "queryParameterName": {{(cursor.Target == ApiCursorTarget.Query ? PythonLiteral.Str(cursor.QueryParameterName!) : "None")}}, "bodyPath": {{(cursor.Target == ApiCursorTarget.Body ? PythonLiteral.Str(cursor.BodyPath!) : "None")}}, "maxPages": {{cursor.MaxPages}}}""";

    private static string RenderBootstrapBodyFields(List<ApiBootstrapBodyField>? fields) =>
        fields is null ? "[]" : RenderList(fields, field => !string.IsNullOrWhiteSpace(field.EnvironmentVariableName)
            ? $$"""{"name": {{PythonLiteral.Str(field.Name)}}, "envVar": {{PythonLiteral.Str(field.EnvironmentVariableName)}}}"""
            : $$"""{"name": {{PythonLiteral.Str(field.Name)}}, "value": {{PythonLiteral.Str(field.Value ?? "")}}}""");

    private static string RenderSource(ApiParameterSource source) => source switch
    {
        StaticListSource s => $$"""{"kind": "staticList", "values": [{{string.Join(", ", s.Values.Select(PythonLiteral.Str))}}]}""",
        DiscoverySource d => $$"""{"kind": "discovery", "urlTemplate": {{PythonLiteral.Str(d.UrlTemplate)}}, "itemsPath": {{PythonLiteral.Str(d.ItemsPath)}}, "valuePath": {{PythonLiteral.Str(d.ValuePath)}}}""",
        // "format" is omitted when unset so the runtime's own default stays the single source of truth.
        RangeSource r => $$"""{"kind": "range", "type": {{PythonLiteral.Str(r.Type.ToString())}}, "from": {{PythonLiteral.Str(r.From)}}, "to": {{PythonLiteral.Str(r.To)}}{{RenderFormatSuffix(r.Format)}}}""",
        // Actions is a runtime-interpreted list-of-dicts (RenderBrowserActions), not baked-in Playwright code: it can occur
        // once per parameter, so one generic dispatcher (_run_browser_action) scales better.
        BrowserDiscoverySource b => $$"""{"kind": "browserDiscovery", "discoveryUrl": {{PythonLiteral.Str(b.DiscoveryUrl)}}, "actions": {{RenderBrowserActions(b.Actions)}}}""",
        _ => throw new InvalidOperationException($"Unknown ApiParameterSource type: {source.GetType()}"),
    };

    private static string RenderFormatSuffix(string? format) =>
        format is null ? "" : $$""", "format": {{PythonLiteral.Str(format)}}""";

    // BrowserDiscoverySource.Actions with camelCase keys matching the wire JSON; FramePath is omitted when unset.
    private static string RenderBrowserActions(List<BrowserAction>? actions) =>
        actions is null ? "[]" : RenderList(actions, RenderBrowserAction);

    private static string RenderBrowserAction(BrowserAction action) => action switch
    {
        WaitForAction a => $$"""{"kind": "waitFor", "selector": {{PythonLiteral.Str(a.Selector)}}, "timeoutMs": {{a.TimeoutMs}}{{FramePathSuffix(a.FramePath)}}}""",
        FillAction a => $$"""{"kind": "fill", "selector": {{PythonLiteral.Str(a.Selector)}}, "environmentVariableName": {{PythonLiteral.Str(a.EnvironmentVariableName)}}{{FramePathSuffix(a.FramePath)}}}""",
        // Issue #267: "target" is always emitted ("first"/"last"/"all"), plus
        // "waitAfterMs" for "all" only (the one target that uses it).
        ClickAction a => $$"""{"kind": "click", "selector": {{PythonLiteral.Str(a.Selector)}}, "target": "{{a.Target.ToString().ToLowerInvariant()}}"{{(a.Target == ClickTarget.All ? $", \"waitAfterMs\": {a.WaitAfterMs}" : "")}}{{FramePathSuffix(a.FramePath)}}}""",
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
