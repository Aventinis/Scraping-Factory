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

        // ScrapingPlanValidator already accepts a Groups-based ApiConfig
        // (Issue #54's tree shape) as structurally valid — this generator
        // doesn't have a grouped-template counterpart yet (that's Issue
        // #54's follow-up phase, mirroring how scraper_grouped.py.j2 came
        // one phase after Container-Mode's own flat groundwork). A clear,
        // typed rejection here instead of an implicit NullReferenceException
        // below (ItemsPath/Fields are null whenever Groups is set).
        if (api.Groups is { Count: > 0 })
        {
            throw new NotSupportedException(
                "Api-Konfiguration mit Groups (verschachtelte Antworten, Issue #54) wird von PythonApiCodeGenerator noch nicht unterstützt.");
        }

        var assembly = Assembly.GetExecutingAssembly();

        var fields = api.Fields!.Select(field => new { name = field.Name, path = field.Path }).ToList();
        // Matches RenderHeader's/ValidateApiHeaders's "meaningful" check: an
        // empty-string EnvironmentVariableName never reaches os.environ[...]
        // at runtime, so it shouldn't trigger the import either.
        var needsOsImport = api.Headers?.Any(header => !string.IsNullOrWhiteSpace(header.EnvironmentVariableName)) ?? false;

        var template = EmbeddedScribanTemplate.Load(assembly, "scraper_api.py.j2");
        return template.Render(new
        {
            url_template = api.UrlTemplate,
            fields,
            needs_os_import = needsOsImport,
            url_template_literal = PythonLiteral.Str(api.UrlTemplate),
            items_path_literal = PythonLiteral.Str(api.ItemsPath!),
            fields_literal = PythonApiConfigLiteral.RenderFields(api.Fields!),
            parameters_literal = PythonApiConfigLiteral.RenderParameters(api.Parameters),
            headers_literal = PythonApiConfigLiteral.RenderHeaders(api.Headers),
            script_filename = plan.ScriptFileName,
            output_filename = plan.OutputFileBaseName,
        });
    }
}
