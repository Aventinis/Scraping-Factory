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
        if (api.Groups is { Count: > 0 })
        {
            var rootNames = api.Groups.Select(root => root.Name).ToList();
            var groupedTemplate = EmbeddedScribanTemplate.Load(assembly, "scraper_api_grouped.py.j2");
            return groupedTemplate.Render(new
            {
                url_template = api.UrlTemplate,
                root_names = rootNames,
                needs_os_import = NeedsOsImport(api.Headers),
                url_template_literal = PythonLiteral.Str(api.UrlTemplate),
                method_literal = PythonLiteral.Str(api.Method),
                body_literal = PythonApiConfigLiteral.RenderBody(api.Body),
                groups_literal = PythonApiConfigLiteral.RenderGroups(api.Groups),
                parameters_literal = PythonApiConfigLiteral.RenderParameters(api.Parameters),
                headers_literal = PythonApiConfigLiteral.RenderHeaders(api.Headers),
                script_filename = plan.ScriptFileName,
                output_filename = plan.OutputFileBaseName,
                output_is_json = plan.OutputFormat == OutputFormat.Json,
            });
        }

        var fields = api.Fields!.Select(field => new { name = field.Name, path = field.Path }).ToList();

        var template = EmbeddedScribanTemplate.Load(assembly, "scraper_api.py.j2");
        return template.Render(new
        {
            url_template = api.UrlTemplate,
            fields,
            needs_os_import = NeedsOsImport(api.Headers),
            url_template_literal = PythonLiteral.Str(api.UrlTemplate),
            method_literal = PythonLiteral.Str(api.Method),
            body_literal = PythonApiConfigLiteral.RenderBody(api.Body),
            items_path_literal = PythonLiteral.Str(api.ItemsPath!),
            fields_literal = PythonApiConfigLiteral.RenderFields(api.Fields!),
            parameters_literal = PythonApiConfigLiteral.RenderParameters(api.Parameters),
            headers_literal = PythonApiConfigLiteral.RenderHeaders(api.Headers),
            script_filename = plan.ScriptFileName,
            output_filename = plan.OutputFileBaseName,
            output_is_json = plan.OutputFormat == OutputFormat.Json,
        });
    }

    // Matches RenderHeader's/ValidateApiHeaders's "meaningful" check: an
    // empty-string EnvironmentVariableName never reaches os.environ[...] at
    // runtime, so it shouldn't trigger the import either. Shared by both
    // templates above — the header-handling side is identical either way.
    private static bool NeedsOsImport(List<ApiHeader>? headers) =>
        headers?.Any(header => !string.IsNullOrWhiteSpace(header.EnvironmentVariableName)) ?? false;
}
