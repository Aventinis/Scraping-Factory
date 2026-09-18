using System.Reflection;
using System.Text;

namespace ScrapingFactory.Compiler.Backends.Python;

// Combined mode (Issue #239): deliberately NOT an ICodeGenerator registered
// via LanguageModuleRegistry, unlike every other backend in this namespace —
// it needs to *consume* other generators' already-rendered output (one
// script per component), which would require injecting a
// LanguageModuleRegistry into a reflectively self-constructed backend, a
// circular dependency the registry's own discovery mechanism can't support
// (see LanguageModuleRegistry's doc comment). Program.cs's /generate handler
// instead resolves and generates each component's own script through the
// registry itself — exactly like a normal single-mode request would — and
// hands the already-rendered results here purely for the final
// wrapping/merging step.
public static class PythonCombinedScriptGenerator
{
    public static string Generate(
        IReadOnlyList<(string Name, string Script)> components, string scriptFileName, string outputFileBaseName)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var template = EmbeddedScribanTemplate.Load(assembly, "scraper_combined.py.j2");

        // Each component's full script source is embedded as a base64
        // string (not a raw triple-quoted string) so nothing about a
        // component's own generated content — a user-entered block phrase,
        // a static list value, a regex pattern — needs to be re-escaped for
        // safely nesting one already-generated Python file inside another.
        var componentContexts = components.Select(c => new
        {
            name_literal = PythonLiteral.Str(c.Name),
            source_b64_literal = PythonLiteral.Str(Convert.ToBase64String(Encoding.UTF8.GetBytes(c.Script))),
        }).ToList();

        return template.Render(new
        {
            components = componentContexts,
            component_count = components.Count,
            script_filename = scriptFileName,
            output_filename = outputFileBaseName,
        });
    }
}
