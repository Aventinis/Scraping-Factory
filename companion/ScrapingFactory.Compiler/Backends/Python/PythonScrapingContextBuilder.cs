using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Shared Scriban-context construction for the parts of PythonCodeGenerator
// (Static engine) and PythonPlaywrightCodeGenerator (Browser engine) that
// used to build IDENTICAL sets of context keys from the same ScrapingPlan/
// step data, by hand, in two separate files. Unlike the Python templates
// themselves — which genuinely can't share code at all, since Scriban has
// no cross-template includes/recursion (see this project's own repeated
// doc comments on that constraint, e.g. scraper_grouped.py.j2's) — these
// two C# classes have no such technical limitation, so keeping the same
// key set in sync by hand across two files was a pure, avoidable
// duplication risk: Issue #213's own `download_enabled` key had to be added
// to both files separately, and a future key could just as easily be added
// to only one by mistake.
//
// Every method here returns a plain Dictionary<string, object?> rather than
// an anonymous type, specifically so each engine's own Generate() can merge
// in its own additional, engine-specific keys (actions/navigate_action/...
// for the Browser engine, which has no equivalent in Static at all) before
// calling Render() — a sealed anonymous type can't be extended after the
// fact, a Dictionary can. Scriban binds a Dictionary the same way it binds
// an anonymous object or POCO, including when nested as another object's
// own property (e.g. `config.urls` for the Static engine's flat template,
// which expects everything namespaced under `config`, unlike every other
// template here, which reads its own keys at the top level) — confirmed
// directly against the Scriban package this project already depends on
// before this class existed, since a silently-wrong assumption here would
// mean every generated script quietly renders as blank/broken.
internal static class PythonScrapingContextBuilder
{
    // Shared by both engines' Container-Mode (ExtractGroupStep) branch —
    // every key both PythonCodeGenerator/PythonPlaywrightCodeGenerator used
    // to build separately for scraper_grouped.py.j2/playwright_scraper_grouped.py.j2.
    public static Dictionary<string, object?> BuildGroupModeContext(ScrapingPlan plan, ExtractGroupStep groupStep)
    {
        var navigate = plan.Steps.OfType<NavigateStep>().Single();
        return new Dictionary<string, object?>
        {
            ["urls"] = navigate.Urls,
            ["groups_literal"] = PythonGroupTreeLiteral.Render(groupStep.Roots, indent: 0),
            ["root_names"] = groupStep.Roots.Select(root => root.Name).ToList(),
            ["script_filename"] = plan.ScriptFileName,
            ["output_filename"] = plan.OutputFileBaseName,
            ["output_is_json"] = plan.OutputFormat == OutputFormat.Json,
            // Issue #213: gates the download helper's own conditional
            // imports (os/sys/hashlib/urljoin) — see
            // PythonGroupTreeLiteral.AnyDownloadEnabled's own doc comment.
            ["download_enabled"] = PythonGroupTreeLiteral.AnyDownloadEnabled(groupStep.Roots),
            ["change_detection"] = PythonChangeDetectionLiteral.BuildContext(plan.ChangeDetection),
            ["proxy"] = PythonProxyLiteral.BuildContext(plan.Proxy),
            ["hardening"] = PythonHardeningLiteral.BuildContext(plan.Hardening),
            ["pagination"] = PythonPaginationLiteral.BuildContext(plan.Pagination),
            ["external_config"] = PythonExternalConfigLiteral.BuildContext(plan.ExternalConfig),
            // Issue #192/#244: both always rendered, only one ever non-empty
            // for a given plan — see PythonOutputBlueprintLiteral.RenderTree's
            // own doc comment on why.
            ["blueprint_mapping_enabled"] = plan.OutputBlueprint?.SchemaKind == OutputBlueprintSchemaKind.Flat,
            ["blueprint_mapping_literal"] = PythonOutputBlueprintLiteral.Render(plan.OutputBlueprint),
            ["blueprint_tree_mapping_enabled"] = plan.OutputBlueprint?.SchemaKind == OutputBlueprintSchemaKind.Tree,
            ["blueprint_tree_mapping_literal"] = PythonOutputBlueprintLiteral.RenderTree(plan.OutputBlueprint),
        };
    }

    // Shared by both engines' flat-Fields (a plain ExtractStep list, no
    // Groups/Blocks) branch, consumed by scraper.py.j2/playwright_scraper.py.j2.
    // Always includes frame_path per field, even though the Static engine's
    // own template never reads it (a harmless unused key) — FramePath only
    // ever makes sense for the Browser engine's iframe-scoped extraction,
    // but sharing one field-mapping here is what keeps the two engines'
    // own per-field shape from quietly drifting apart the way they
    // previously could (Playwright's own version carried frame_path,
    // Static's plain one didn't, with no single place enforcing they stay
    // otherwise identical).
    public static Dictionary<string, object?> BuildFlatModeContext(ScrapingPlan plan)
    {
        var navigate = plan.Steps.OfType<NavigateStep>().Single();
        var fields = plan.Steps.OfType<ExtractStep>()
            .Select(step => new Dictionary<string, object?>
            {
                ["name"] = step.Name,
                ["selector"] = step.Selector,
                ["attribute"] = step.Attribute,
                ["frame_path"] = step.FramePath,
                ["transforms_literal"] = PythonFieldTransformLiteral.Render(step.Transforms),
            })
            .ToList();

        return new Dictionary<string, object?>
        {
            ["urls"] = navigate.Urls,
            ["fields"] = fields,
            ["script_filename"] = plan.ScriptFileName,
            ["output_filename"] = plan.OutputFileBaseName,
            ["output_is_json"] = plan.OutputFormat == OutputFormat.Json,
            ["change_detection"] = PythonChangeDetectionLiteral.BuildContext(plan.ChangeDetection),
            ["proxy"] = PythonProxyLiteral.BuildContext(plan.Proxy),
            ["hardening"] = PythonHardeningLiteral.BuildContext(plan.Hardening),
            ["pagination"] = PythonPaginationLiteral.BuildContext(plan.Pagination),
            ["external_config"] = PythonExternalConfigLiteral.BuildContext(plan.ExternalConfig),
            ["blueprint_mapping_literal"] = PythonOutputBlueprintLiteral.Render(plan.OutputBlueprint),
        };
    }

    // Shared by both engines' Blocks (ExtractionBlockStep) branch, consumed
    // by scraper_blocks.py.j2/playwright_scraper_blocks.py.j2. Each engine
    // still separately computes change_detection_any as a plain bool where
    // it needs it standalone (Playwright's own needs_os_import folds it in)
    // — a single trivial LINQ .Any() call recomputed twice isn't the kind
    // of multi-line, drift-prone duplication this class exists to remove.
    public static Dictionary<string, object?> BuildBlocksContext(ScrapingPlan plan, ExtractionBlockStep blockStep)
    {
        var navigate = plan.Steps.OfType<NavigateStep>().Single();
        return new Dictionary<string, object?>
        {
            ["urls"] = navigate.Urls,
            ["blocks_literal"] = PythonExtractionBlockLiteral.Render(blockStep.Blocks),
            ["blocks_meta"] = blockStep.Blocks.Select(b => new { name = b.Name, shape = b.Groups is not null ? "group" : "flat" }).ToList(),
            ["any_flat"] = blockStep.Blocks.Any(b => b.Groups is null),
            ["any_group"] = blockStep.Blocks.Any(b => b.Groups is not null),
            ["any_csv"] = blockStep.Blocks.Any(b => b.Groups is null && b.OutputFormat != OutputFormat.Json),
            ["any_json_output"] = blockStep.Blocks.Any(b => b.OutputFormat == OutputFormat.Json),
            ["hardening_any"] = blockStep.Blocks.Any(b => b.Hardening is { Count: > 0 }),
            ["hardening_has_baseline_any"] = blockStep.Blocks.Any(b => b.Hardening?.Any(check => check is BaselineCheck) == true),
            ["change_detection_any"] = blockStep.Blocks.Any(b => b.ChangeDetection is not null),
            ["proxy"] = PythonProxyLiteral.BuildContext(plan.Proxy),
            ["pagination"] = PythonPaginationLiteral.BuildContext(plan.Pagination),
            ["script_filename"] = plan.ScriptFileName,
        };
    }
}
