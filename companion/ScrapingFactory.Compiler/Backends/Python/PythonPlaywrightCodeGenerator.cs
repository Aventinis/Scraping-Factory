using System.Reflection;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Generates a Playwright-based script for the Browser engine (dynamically
// rendered pages). Navigate/WaitFor steps become inline actions rendered
// from their own small fragment templates, one per step, in order — that's
// the per-step-type template composition the static generator's monolithic
// template doesn't need. Extract steps still end up aggregated into
// SELECTORS/ATTRIBUTES dicts like the static generator, since extraction
// itself has no per-step control flow (unlike Navigate/WaitFor, which each
// correspond to one specific action at one specific point in the flow).
public sealed class PythonPlaywrightCodeGenerator : ICodeGenerator
{
    public string LanguageId => "python";
    public ScrapingEngine Engine => ScrapingEngine.Browser;

    public string Generate(ScrapingPlan plan)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var navigateTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_navigate_step.py.j2");
        var waitTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_wait_step.py.j2");
        var shellTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_scraper.py.j2");

        var navigate = plan.Steps.OfType<NavigateStep>().Single();
        var fields = plan.Steps.OfType<ExtractStep>()
            .Select(step => new { name = step.Name, selector = step.Selector, attribute = step.Attribute })
            .ToList();

        var actionLines = plan.Steps
            .Select(step => step switch
            {
                NavigateStep s => navigateTemplate.Render(new { step = new { url = s.Url } }),
                WaitForStep s => waitTemplate.Render(new { step = new { selector = s.Selector, timeout_ms = s.TimeoutMs } }),
                _ => null,
            })
            .Where(line => line is not null)
            .Select(line => line!.TrimEnd());

        var actions = string.Join("\n", actionLines);

        return shellTemplate.Render(new { url = navigate.Url, fields, actions });
    }
}
