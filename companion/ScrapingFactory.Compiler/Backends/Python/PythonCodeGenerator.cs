using System.Reflection;
using Scriban;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

public sealed class PythonCodeGenerator : ICodeGenerator
{
    public string LanguageId => "python";

    public string Generate(ScrapingConfig config)
    {
        var assembly = Assembly.GetExecutingAssembly();
        using var stream = assembly.GetManifestResourceStream("scraper.py.j2")
            ?? throw new InvalidOperationException("Embedded template 'scraper.py.j2' not found in assembly.");
        using var reader = new StreamReader(stream);
        var templateText = reader.ReadToEnd();

        var template = Template.Parse(templateText);
        if (template.HasErrors)
            throw new InvalidOperationException(
                $"Template parse errors: {string.Join(", ", template.Messages)}");

        return template.Render(new { config });
    }
}
