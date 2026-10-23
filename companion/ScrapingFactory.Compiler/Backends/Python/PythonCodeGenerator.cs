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

        // Blocks: its own template, since Scriban cannot iterate N independently shaped blocks (see ExtractionBlockStep).
        var blockStep = plan.Steps.OfType<ExtractionBlockStep>().SingleOrDefault();
        if (blockStep is not null)
        {
            var blocksTemplate = EmbeddedScribanTemplate.Load(assembly, "scraper_blocks.py.j2");
            return blocksTemplate.Render(PythonScrapingContextBuilder.BuildBlocksContext(plan, blockStep));
        }

        // Container mode: its own template, since Scriban cannot recurse over a tree of unknown depth.
        var groupStep = plan.Steps.OfType<ExtractGroupStep>().SingleOrDefault();
        if (groupStep is not null)
        {
            var groupedTemplate = EmbeddedScribanTemplate.Load(assembly, "scraper_grouped.py.j2");
            return groupedTemplate.Render(PythonScrapingContextBuilder.BuildGroupModeContext(plan, groupStep));
        }

        // The flat template only knows url + fields: derive that view from the Steps here. Keys are read at the top level, which also lets the shared fragments (`#@include`) work.
        var template = EmbeddedScribanTemplate.Load(assembly, "scraper.py.j2");
        return template.Render(PythonScrapingContextBuilder.BuildFlatModeContext(plan));
    }
}
