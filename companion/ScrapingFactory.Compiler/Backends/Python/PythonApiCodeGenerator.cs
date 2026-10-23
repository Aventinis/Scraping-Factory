using System.Reflection;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// API mode: generates a requests-only script that resolves each parameter's values (static list, range, discovery),
// takes the cartesian product, and calls the endpoint once per combination (runtime: scraper_api.py.j2). The API
// call is the only step besides NavigateStep, so there is no per-step composition.
public sealed class PythonApiCodeGenerator : ICodeGenerator
{
    public string LanguageId => "python";
    public ScrapingEngine Engine => ScrapingEngine.Api;

    public string Generate(ScrapingPlan plan)
    {
        var apiStep = plan.Steps.OfType<ApiCallStep>().Single();
        var api = apiStep.Config;
        var assembly = Assembly.GetExecutingAssembly();

        // The tree shape has its own template: Scriban cannot recurse over a tree of unknown depth, so the structure is
        // pre-rendered into a Python literal (PythonApiConfigLiteral.RenderGroups) and walked by _extract_api_group.
        var changeDetection = PythonChangeDetectionLiteral.BuildContext(plan.ChangeDetection);
        var proxy = PythonProxyLiteral.BuildContext(plan.Proxy);
        var requestDelay = PythonRequestDelayLiteral.BuildContext(plan);
        var robotsCheck = PythonRobotsDisallowLiteral.BuildContext(plan);
        var retry = PythonRetryLiteral.BuildContext(plan.Retry);
        var hardening = PythonHardeningLiteral.BuildContext(plan.Hardening);
        var externalConfig = PythonExternalConfigLiteral.BuildContext(plan.ExternalConfig);

        // Playwright and the _require_env helper are conditional: only scripts using browser discovery pull them in.
        var needsBrowserDiscovery = api.Parameters.Any(p => p.Source is BrowserDiscoverySource);
        // A configured bootstrap always pulls in the _require_env helper (clean exit 78, and `sys` for its failure path).
        var hasBootstrap = api.Bootstrap is not null;
        var needsRequireEnvHelper = hasBootstrap || api.Parameters.Any(p =>
            p.Source is BrowserDiscoverySource { Actions: { } actions } && actions.Any(a => a is FillAction));

        if (api.Groups is { Count: > 0 })
        {
            var rootNames = api.Groups.Select(root => root.Name).ToList();
            var groupedTemplate = EmbeddedScribanTemplate.Load(assembly, "scraper_api_grouped.py.j2");
            return groupedTemplate.Render(new
            {
                url_template = api.UrlTemplate,
                root_names = rootNames,
                needs_os_import = NeedsOsImport(api.Headers, plan.ChangeDetection, plan.Proxy, needsRequireEnvHelper),
                needs_browser_discovery = needsBrowserDiscovery,
                needs_require_env_helper = needsRequireEnvHelper,
                url_template_literal = PythonLiteral.Str(api.UrlTemplate),
                method_literal = PythonLiteral.Str(api.Method),
                body_literal = PythonApiConfigLiteral.RenderBody(api.Body),
                groups_literal = PythonApiConfigLiteral.RenderGroups(api.Groups),
                parameters_literal = PythonApiConfigLiteral.RenderParameters(api.Parameters),
                headers_literal = PythonApiConfigLiteral.RenderHeaders(api.Headers),
                embedded_json_source = api.EmbeddedJsonSource is not null,
                embedded_json_source_literal = PythonApiConfigLiteral.RenderEmbeddedJsonSource(api.EmbeddedJsonSource),
                has_bootstrap = hasBootstrap,
                bootstrap_literal = PythonApiConfigLiteral.RenderBootstrap(api.Bootstrap),
                cursor_pagination_enabled = api.CursorPagination is not null,
                cursor_pagination_literal = PythonApiConfigLiteral.RenderCursorPagination(api.CursorPagination),
                link_pagination_enabled = api.LinkHeaderPagination is not null,
                link_pagination_max_pages = api.LinkHeaderPagination?.MaxPages ?? 0,
                script_filename = plan.ScriptFileName,
                output_filename = plan.OutputFileBaseName,
                output_is_json = plan.OutputFormat == OutputFormat.Json,
                output_is_sqlite = plan.OutputFormat == OutputFormat.Sqlite,
                output_is_xlsx = plan.OutputFormat == OutputFormat.Xlsx,
                change_detection = changeDetection,
                proxy,
                request_delay = requestDelay,
                robots_check = robotsCheck,
                append_output = plan.AppendsOutput,
                retry,
                dedup = PythonDeduplicationLiteral.BuildContext(plan.Deduplication),
                text_selector = PythonTextSelectorLiteral.BuildContext(plan),
                hardening,
                external_config = externalConfig,
                // Unlike container mode, the row-scope group cannot be resolved here (ApiGroup has no Repeating flag); the
                // template's runtime mirror of OutputBlueprintFlattening resolves it from the real response.
                blueprint_mapping_enabled = plan.OutputBlueprint?.SchemaKind == OutputBlueprintSchemaKind.Flat,
                blueprint_mapping_literal = PythonOutputBlueprintLiteral.Render(plan.OutputBlueprint),
                // Tree schema: resolved at run time as well (mirror of ResolveContainerTreeRowScopes).
                blueprint_tree_mapping_enabled = plan.OutputBlueprint?.SchemaKind == OutputBlueprintSchemaKind.Tree,
                blueprint_tree_mapping_literal = PythonOutputBlueprintLiteral.RenderTree(plan.OutputBlueprint),
                hidden_field_names_literal = PythonLiteral.StrList(PythonApiConfigLiteral.CollectHiddenFieldNames(api.Groups)),
            });
        }

        var fields = api.Fields!.Select(field => new { name = field.Name, path = field.Path ?? "" }).ToList();

        var template = EmbeddedScribanTemplate.Load(assembly, "scraper_api.py.j2");
        return template.Render(new
        {
            url_template = api.UrlTemplate,
            fields,
            needs_os_import = NeedsOsImport(api.Headers, plan.ChangeDetection, plan.Proxy, needsRequireEnvHelper),
            needs_browser_discovery = needsBrowserDiscovery,
            needs_require_env_helper = needsRequireEnvHelper,
            url_template_literal = PythonLiteral.Str(api.UrlTemplate),
            method_literal = PythonLiteral.Str(api.Method),
            body_literal = PythonApiConfigLiteral.RenderBody(api.Body),
            items_path_literal = PythonLiteral.Str(api.ItemsPath!),
            fields_literal = PythonApiConfigLiteral.RenderFields(api.Fields!),
            parameters_literal = PythonApiConfigLiteral.RenderParameters(api.Parameters),
            headers_literal = PythonApiConfigLiteral.RenderHeaders(api.Headers),
            embedded_json_source = api.EmbeddedJsonSource is not null,
            embedded_json_source_literal = PythonApiConfigLiteral.RenderEmbeddedJsonSource(api.EmbeddedJsonSource),
            has_bootstrap = hasBootstrap,
            bootstrap_literal = PythonApiConfigLiteral.RenderBootstrap(api.Bootstrap),
            cursor_pagination_enabled = api.CursorPagination is not null,
            cursor_pagination_literal = PythonApiConfigLiteral.RenderCursorPagination(api.CursorPagination),
                link_pagination_enabled = api.LinkHeaderPagination is not null,
                link_pagination_max_pages = api.LinkHeaderPagination?.MaxPages ?? 0,
            script_filename = plan.ScriptFileName,
            output_filename = plan.OutputFileBaseName,
            output_is_json = plan.OutputFormat == OutputFormat.Json,
                output_is_sqlite = plan.OutputFormat == OutputFormat.Sqlite,
                output_is_xlsx = plan.OutputFormat == OutputFormat.Xlsx,
            change_detection = changeDetection,
            proxy,
            request_delay = requestDelay,
                robots_check = robotsCheck,
                append_output = plan.AppendsOutput,
            retry,
            dedup = PythonDeduplicationLiteral.BuildContext(plan.Deduplication),
            text_selector = PythonTextSelectorLiteral.BuildContext(plan),
            hardening,
            external_config = externalConfig,
            blueprint_mapping_literal = PythonOutputBlueprintLiteral.Render(plan.OutputBlueprint),
            hidden_field_names_literal = PythonLiteral.StrList(api.Fields!.Where(f => f.HiddenFromOutput).Select(f => f.Name)),
        });
    }

    // Matches RenderHeader / ValidateApiHeaders: an empty env var name never reaches os.environ, so it must not trigger
    // the import. Change detection and proxy also read env vars, hence the same import. Shared by both templates.
    private static bool NeedsOsImport(List<ApiHeader>? headers, ChangeDetectionConfig? changeDetection, ProxyConfig? proxy, bool needsRequireEnvHelper) =>
        (headers?.Any(header => !string.IsNullOrWhiteSpace(header.EnvironmentVariableName)) ?? false) ||
        changeDetection is not null || proxy is not null || needsRequireEnvHelper;
}
