using System.Reflection;
using System.Text;

namespace ScrapingFactory.Compiler.Backends.Python;

// Combined mode is deliberately not an ICodeGenerator in LanguageModuleRegistry: it consumes other generators'
// rendered output, which would need the registry injected into a reflectively constructed backend (circular).
// GenerateEndpoint.Combined.cs generates each component through the registry and hands the results here to wrap and merge.
public static class PythonCombinedScriptGenerator
{
    public static string Generate(
        IReadOnlyList<(string Name, string Script)> components, string scriptFileName, string outputFileBaseName)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var template = EmbeddedScribanTemplate.Load(assembly, "scraper_combined.py.j2");

        // Each component's script is embedded as base64 so nothing in it needs re-escaping inside another Python file.
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
