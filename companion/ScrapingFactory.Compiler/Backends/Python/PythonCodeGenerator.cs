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
        var assembly = Assembly.GetExecutingAssembly();

        // Issue #182: Blocks replaces every other extraction shape wholesale
        // — see ExtractionBlockStep. Its own template, same reasoning as
        // Container-Mode's own scraper_grouped.py.j2 (Scriban can't recurse
        // over an unknown number of independently-shaped blocks the way a
        // flat Fields loop can iterate one list), just generalized to N
        // shapes at once instead of exactly one tree.
        var blockStep = plan.Steps.OfType<ExtractionBlockStep>().SingleOrDefault();
        if (blockStep is not null)
        {
            var blocksTemplate = EmbeddedScribanTemplate.Load(assembly, "scraper_blocks.py.j2");
            return blocksTemplate.Render(PythonScrapingContextBuilder.BuildBlocksContext(plan, blockStep));
        }

        // Container-Mode replaces the flat fields shape wholesale — see
        // ExtractGroupStep. Its own template because Scriban can't recurse
        // over a tree of unknown depth the way the flat template's Fields
        // loop can iterate a flat list.
        var groupStep = plan.Steps.OfType<ExtractGroupStep>().SingleOrDefault();
        if (groupStep is not null)
        {
            var groupedTemplate = EmbeddedScribanTemplate.Load(assembly, "scraper_grouped.py.j2");
            return groupedTemplate.Render(PythonScrapingContextBuilder.BuildGroupModeContext(plan, groupStep));
        }

        // The template only knows a flat url + fields shape — derive that
        // view from the canonical Steps IR here rather than changing the
        // template, which has no need for per-step composition (unlike the
        // Browser engine's Playwright template). Unlike every other
        // template here, scraper.py.j2 expects everything namespaced under
        // `config` rather than reading its own keys at the top level —
        // PythonScrapingContextBuilder.BuildFlatModeContext returns the same
        // shared dictionary either way, nested here to match.
        var template = EmbeddedScribanTemplate.Load(assembly, "scraper.py.j2");
        return template.Render(new { config = PythonScrapingContextBuilder.BuildFlatModeContext(plan) });
    }
}
