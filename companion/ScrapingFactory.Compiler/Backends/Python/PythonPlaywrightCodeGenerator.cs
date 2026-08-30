using System.Reflection;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Generates a Playwright-based script for the Browser engine (dynamically
// rendered pages, and simple login flows). Navigate/WaitFor/Fill/Click
// steps become inline actions rendered from their own small fragment
// templates, one per step, in order — that's the per-step-type template
// composition the static generator's monolithic template doesn't need.
// Extract steps still end up aggregated into SELECTORS/ATTRIBUTES dicts
// like the static generator, since extraction itself has no per-step
// control flow (unlike the other step types, which each correspond to one
// specific action at one specific point in the flow).
public sealed class PythonPlaywrightCodeGenerator : ICodeGenerator
{
    public string LanguageId => "python";
    public ScrapingEngine Engine => ScrapingEngine.Browser;

    public string Generate(ScrapingPlan plan)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var navigateTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_navigate_step.py.j2");
        var waitTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_wait_step.py.j2");
        var fillTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_fill_step.py.j2");
        var clickTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_click_step.py.j2");
        var scrollTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_scroll_step.py.j2");
        var shellTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_scraper.py.j2");

        var navigate = plan.Steps.OfType<NavigateStep>().Single();

        var actionLines = plan.Steps
            .Select(step => step switch
            {
                NavigateStep s => navigateTemplate.Render(new { step = new { url = s.Url } }),
                WaitForStep s => waitTemplate.Render(new { step = new { selector = s.Selector, timeout_ms = s.TimeoutMs } }),
                FillStep s => fillTemplate.Render(new { step = new { selector = s.Selector, env_var = s.EnvironmentVariableName } }),
                ClickStep s => clickTemplate.Render(new { step = new { selector = s.Selector } }),
                ScrollStep s => scrollTemplate.Render(new
                {
                    step = new
                    {
                        container_selector = s.ContainerSelector,
                        load_more_button_selector = s.LoadMoreButtonSelector,
                        max_iterations = s.MaxIterations,
                        wait_after_ms = s.WaitAfterMs,
                    },
                }),
                _ => null,
            })
            .Where(line => line is not null)
            .Select(line => line!.TrimEnd());

        var actions = string.Join("\n", actionLines);
        var needsOsImport = plan.Steps.OfType<FillStep>().Any();

        // Container-Mode: login/wait steps (if any) still run first — only
        // the extraction phase after them differs (group tree → XML instead
        // of flat fields → CSV). See ExtractGroupStep and
        // PythonCodeGenerator's equivalent branch.
        var groupStep = plan.Steps.OfType<ExtractGroupStep>().SingleOrDefault();
        if (groupStep is not null)
        {
            var groupsLiteral = PythonGroupTreeLiteral.Render(groupStep.Roots, indent: 0);
            var rootNames = groupStep.Roots.Select(root => root.Name).ToList();
            var groupedShellTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_scraper_grouped.py.j2");
            return groupedShellTemplate.Render(new
            {
                url = navigate.Url,
                groups_literal = groupsLiteral,
                root_names = rootNames,
                actions,
                needs_os_import = needsOsImport,
                script_filename = plan.ScriptFileName,
                output_filename = plan.OutputFileBaseName,
            });
        }

        var fields = plan.Steps.OfType<ExtractStep>()
            .Select(step => new { name = step.Name, selector = step.Selector, attribute = step.Attribute })
            .ToList();

        return shellTemplate.Render(new
        {
            url = navigate.Url, fields, actions, needs_os_import = needsOsImport,
            script_filename = plan.ScriptFileName, output_filename = plan.OutputFileBaseName,
        });
    }
}
