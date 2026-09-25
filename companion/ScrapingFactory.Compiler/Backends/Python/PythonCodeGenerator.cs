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
            return blocksTemplate.Render(new
            {
                urls = navigate.Urls, script_filename = plan.ScriptFileName,
                blocks_literal = PythonExtractionBlockLiteral.Render(blockStep.Blocks),
                blocks_meta = blockStep.Blocks.Select(b => new { name = b.Name, shape = b.Groups is not null ? "group" : "flat" }).ToList(),
                any_flat = blockStep.Blocks.Any(b => b.Groups is null),
                any_group = blockStep.Blocks.Any(b => b.Groups is not null),
                any_csv = blockStep.Blocks.Any(b => b.Groups is null && b.OutputFormat != OutputFormat.Json),
                any_json_output = blockStep.Blocks.Any(b => b.OutputFormat == OutputFormat.Json),
                hardening_any = blockStep.Blocks.Any(b => b.Hardening is { Count: > 0 }),
                hardening_has_baseline_any = blockStep.Blocks.Any(b => b.Hardening?.Any(check => check is BaselineCheck) == true),
                change_detection_any = blockStep.Blocks.Any(b => b.ChangeDetection is not null),
                proxy = PythonProxyLiteral.BuildContext(plan.Proxy),
                pagination = PythonPaginationLiteral.BuildContext(plan.Pagination),
            });
        }

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
                proxy = PythonProxyLiteral.BuildContext(plan.Proxy),
                hardening = PythonHardeningLiteral.BuildContext(plan.Hardening),
                pagination = PythonPaginationLiteral.BuildContext(plan.Pagination),
                external_config = PythonExternalConfigLiteral.BuildContext(plan.ExternalConfig),
                // Issue #192: the runtime walker (_flatten_group_tree_for_blueprint)
                // determines everything it needs purely from BLUEPRINT_MAPPING plus
                // a structural "does this subtree contain a mapped field" check —
                // no row-scope group name needs to reach the template at all.
                // ScrapingPlanValidator's own OutputBlueprintFlattening call already
                // guarantees, before codegen ever runs, that this mapping resolves
                // to exactly one unambiguous row layout.
                blueprint_mapping_enabled = plan.OutputBlueprint is not null,
                blueprint_mapping_literal = PythonOutputBlueprintLiteral.Render(plan.OutputBlueprint),
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
                proxy = PythonProxyLiteral.BuildContext(plan.Proxy),
                hardening = PythonHardeningLiteral.BuildContext(plan.Hardening),
                pagination = PythonPaginationLiteral.BuildContext(plan.Pagination),
                external_config = PythonExternalConfigLiteral.BuildContext(plan.ExternalConfig),
                blueprint_mapping_literal = PythonOutputBlueprintLiteral.Render(plan.OutputBlueprint),
            },
        });
    }
}
