using System.Reflection;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

public sealed class PythonCodeGenerator : ICodeGenerator
{
    public string LanguageId => "python";
    public ScrapingEngine Engine => ScrapingEngine.Static;

    public string Generate(ScrapingPlan plan)
    {
        // The template only knows a flat url + fields shape — derive that
        // view from the canonical Steps IR here rather than changing the
        // template, which has no need for per-step composition (unlike the
        // Browser engine's Playwright template).
        var navigate = plan.Steps.OfType<NavigateStep>().Single();
        var fields = plan.Steps.OfType<ExtractStep>()
            .Select(step => new { name = step.Name, selector = step.Selector, attribute = step.Attribute })
            .ToList();

        var template = EmbeddedScribanTemplate.Load(Assembly.GetExecutingAssembly(), "scraper.py.j2");
        return template.Render(new { config = new { url = navigate.Url, fields } });
    }
}
