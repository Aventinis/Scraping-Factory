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
        var navigate = plan.Steps.OfType<NavigateStep>().Single();
        var assembly = Assembly.GetExecutingAssembly();

        // Container-Mode replaces the flat fields shape wholesale — see
        // ExtractGroupStep. Its own template because Scriban can't recurse
        // over a tree of unknown depth the way the flat template's Fields
        // loop can iterate a flat list.
        var groupStep = plan.Steps.OfType<ExtractGroupStep>().SingleOrDefault();
        if (groupStep is not null)
        {
            var groupsLiteral = PythonGroupTreeLiteral.Render(groupStep.Roots, indent: 0);
            var rootNames = groupStep.Roots.Select(root => root.Name).ToList();
            var groupedTemplate = EmbeddedScribanTemplate.Load(assembly, "scraper_grouped.py.j2");
            return groupedTemplate.Render(new
            {
                urls = navigate.Urls, groups_literal = groupsLiteral, root_names = rootNames,
                script_filename = plan.ScriptFileName, output_filename = plan.OutputFileBaseName,
                output_is_json = plan.OutputFormat == OutputFormat.Json,
                change_detection = PythonChangeDetectionLiteral.BuildContext(plan.ChangeDetection),
            });
        }

        // The template only knows a flat url + fields shape — derive that
        // view from the canonical Steps IR here rather than changing the
        // template, which has no need for per-step composition (unlike the
        // Browser engine's Playwright template).
        var fields = plan.Steps.OfType<ExtractStep>()
            .Select(step => new
            {
                name = step.Name, selector = step.Selector, attribute = step.Attribute,
                transforms_literal = PythonFieldTransformLiteral.Render(step.Transforms),
            })
            .ToList();

        var template = EmbeddedScribanTemplate.Load(assembly, "scraper.py.j2");
        return template.Render(new
        {
            config = new
            {
                urls = navigate.Urls, fields,
                script_filename = plan.ScriptFileName, output_filename = plan.OutputFileBaseName,
                output_is_json = plan.OutputFormat == OutputFormat.Json,
                change_detection = PythonChangeDetectionLiteral.BuildContext(plan.ChangeDetection),
            },
        });
    }
}
