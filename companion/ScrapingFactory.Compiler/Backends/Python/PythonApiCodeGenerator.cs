using System.Reflection;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// API-Mode (Issue #53): generates a requests-only script (no BeautifulSoup)
// that resolves each ApiParameter's values (static list, computed range, or
// a second "discovery" request), takes the cartesian product across all of
// them, and calls the main endpoint once per combination — see
// scraper_api.py.j2 for the runtime side of this. Always the sole step
// besides NavigateStep (see ApiCallStep/ScrapingPlanBuilder), so unlike
// PythonPlaywrightCodeGenerator there's no per-step composition to do here.
public sealed class PythonApiCodeGenerator : ICodeGenerator
{
    public string LanguageId => "python";
    public ScrapingEngine Engine => ScrapingEngine.Api;

    public string Generate(ScrapingPlan plan)
    {
        var apiStep = plan.Steps.OfType<ApiCallStep>().Single();
        var api = apiStep.Config;
        var assembly = Assembly.GetExecutingAssembly();

        // Issue #54's tree shape gets its own template, exactly the
        // precedent Container-Mode already set (scraper.py.j2 vs.
        // scraper_grouped.py.j2) — Scriban can't recurse over a tree of
        // unknown depth the way the flat template's Fields loop can iterate
        // a flat list, so the tree *structure* is pre-rendered into a Python
        // literal in C# (PythonApiConfigLiteral.RenderGroups) and a generic
        // runtime walk (_extract_api_group) consumes it.
        var changeDetection = PythonChangeDetectionLiteral.BuildContext(plan.ChangeDetection);
        var proxy = PythonProxyLiteral.BuildContext(plan.Proxy);
        var requestDelay = PythonRequestDelayLiteral.BuildContext(plan.RequestDelay);
        var retry = PythonRetryLiteral.BuildContext(plan.Retry);
        var hardening = PythonHardeningLiteral.BuildContext(plan.Hardening);
        var externalConfig = PythonExternalConfigLiteral.BuildContext(plan.ExternalConfig);

        // Issue #216: Playwright (and the shared EXIT_MISSING_ENV_VAR/
        // _require_env helper, needed when a discovery action itself fills
        // in a credential) are both conditional dependencies — every other
        // Api-mode script stays exactly as lightweight as before this
        // existed (see Architecture Decision #4's own note on Engine.Api
        // being a deliberate compromise).
        var needsBrowserDiscovery = api.Parameters.Any(p => p.Source is BrowserDiscoverySource);
        // Issue #220: the bootstrap request reads its credentials via
        // _require_env too (a clean exit 78 instead of a KeyError
        // traceback), and its own failure path needs `sys` — so a
        // configured bootstrap always pulls in the helper, whether or not
        // it actually declares an env var.
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
                script_filename = plan.ScriptFileName,
                output_filename = plan.OutputFileBaseName,
                output_is_json = plan.OutputFormat == OutputFormat.Json,
                change_detection = changeDetection,
                proxy,
                request_delay = requestDelay,
                retry,
                hardening,
                external_config = externalConfig,
                // Issue #192: unlike Container-Mode, the row-scope group
                // can't be resolved here — ApiGroup has no explicit
                // Repeating flag (Architecture Decision #6), so the same
                // resolution scraper_api_grouped.py.j2's own runtime mirror
                // of OutputBlueprintFlattening does happens at script run
                // time instead, once the real response shape is known.
                blueprint_mapping_enabled = plan.OutputBlueprint?.SchemaKind == OutputBlueprintSchemaKind.Flat,
                blueprint_mapping_literal = PythonOutputBlueprintLiteral.Render(plan.OutputBlueprint),
                // Issue #244: same "resolved dynamically at run time" story
                // as the flat mapping's own row-scope note just above —
                // scraper_api_grouped.py.j2's own runtime mirror of
                // ResolveContainerTreeRowScopes resolves each target group's
                // scope once the real response is known, not here.
                blueprint_tree_mapping_enabled = plan.OutputBlueprint?.SchemaKind == OutputBlueprintSchemaKind.Tree,
                blueprint_tree_mapping_literal = PythonOutputBlueprintLiteral.RenderTree(plan.OutputBlueprint),
                // Issue #206 follow-up: see PythonApiConfigLiteral.
                // CollectHiddenFieldNames's own doc comment.
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
            script_filename = plan.ScriptFileName,
            output_filename = plan.OutputFileBaseName,
            output_is_json = plan.OutputFormat == OutputFormat.Json,
            change_detection = changeDetection,
            proxy,
            request_delay = requestDelay,
            retry,
            hardening,
            external_config = externalConfig,
            blueprint_mapping_literal = PythonOutputBlueprintLiteral.Render(plan.OutputBlueprint),
            hidden_field_names_literal = PythonLiteral.StrList(api.Fields!.Where(f => f.HiddenFromOutput).Select(f => f.Name)),
        });
    }

    // Matches RenderHeader's/ValidateApiHeaders's "meaningful" check: an
    // empty-string EnvironmentVariableName never reaches os.environ[...] at
    // runtime, so it shouldn't trigger the import either. Shared by both
    // templates above — the header-handling side is identical either way.
    // Issue #87/#88: change detection and proxy support also read env vars
    // at runtime (SMTP/webhook credentials, proxy URL list), same reason a
    // configured header already needs `import os`.
    // Issue #216: needsRequireEnvHelper also needs `os` — _require_env reads
    // os.environ[...] the same way FillStep's own copy already does in the
    // Playwright templates.
    private static bool NeedsOsImport(List<ApiHeader>? headers, ChangeDetectionConfig? changeDetection, ProxyConfig? proxy, bool needsRequireEnvHelper) =>
        (headers?.Any(header => !string.IsNullOrWhiteSpace(header.EnvironmentVariableName)) ?? false) ||
        changeDetection is not null || proxy is not null || needsRequireEnvHelper;
}
