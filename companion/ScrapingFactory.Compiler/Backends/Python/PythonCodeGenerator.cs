using System.Reflection;
using Scriban;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

public sealed class PythonCodeGenerator : ICodeGenerator
{
    public string LanguageId => "python";

    public string Generate(ScrapingPlan plan)
    {
        // The template only knows a flat url + fields shape (Phase 2 will
        // restructure it around step types) — derive that view from the
        // canonical Steps IR here rather than changing the template now.
        var navigate = plan.Steps.OfType<NavigateStep>().Single();
        var fields = plan.Steps.OfType<ExtractStep>()
            .Select(step => new { name = step.Name, selector = step.Selector, attribute = step.Attribute })
            .ToList();

        var assembly = Assembly.GetExecutingAssembly();
        using var stream = assembly.GetManifestResourceStream("scraper.py.j2")
            ?? throw new InvalidOperationException("Embedded template 'scraper.py.j2' not found in assembly.");
        using var reader = new StreamReader(stream);
        var templateText = reader.ReadToEnd();

        var template = Template.Parse(templateText);
        if (template.HasErrors)
            throw new InvalidOperationException(
                $"Template parse errors: {string.Join(", ", template.Messages)}");

        return template.Render(new { config = new { url = navigate.Url, fields } });
    }
}
