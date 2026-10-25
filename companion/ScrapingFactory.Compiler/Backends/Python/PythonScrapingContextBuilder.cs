using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Builds the Scriban context keys that PythonCodeGenerator (Static) and PythonPlaywrightCodeGenerator (Browser)
// need identically, once, so a new key cannot be added to only one engine (PythonCodeGeneratorParityTests checks
// it). Each method returns a Dictionary, not an anonymous type, so an engine can add its own keys before Render().
internal static class PythonScrapingContextBuilder
{
    // Container mode (scraper_grouped / playwright_scraper_grouped).
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
            ["output_is_sqlite"] = plan.OutputFormat == OutputFormat.Sqlite,
            ["output_is_xlsx"] = plan.OutputFormat == OutputFormat.Xlsx,
            // Gates the download helper's conditional imports (PythonGroupTreeLiteral.AnyDownloadEnabled).
            ["download_enabled"] = PythonGroupTreeLiteral.AnyDownloadEnabled(groupStep.Roots),
            // Every hidden field name in the tree; the templates strip those elements right before writing.
            ["hidden_field_names_literal"] = PythonLiteral.StrList(PythonGroupTreeLiteral.CollectHiddenFieldNames(groupStep.Roots)),
            ["change_detection"] = PythonChangeDetectionLiteral.BuildContext(plan.ChangeDetection),
            ["proxy"] = PythonProxyLiteral.BuildContext(plan.Proxy),
            ["request_delay"] = PythonRequestDelayLiteral.BuildContext(plan),
            ["robots_check"] = PythonRobotsDisallowLiteral.BuildContext(plan),
            ["append_output"] = plan.AppendsOutput,
            ["retry"] = PythonRetryLiteral.BuildContext(plan.Retry),
            ["request_headers"] = PythonRequestHeadersLiteral.BuildContext(plan.Headers),
            ["text_selector"] = PythonTextSelectorLiteral.BuildContext(plan),
            ["dedup"] = PythonDeduplicationLiteral.BuildContext(plan.Deduplication),
            ["hardening"] = PythonHardeningLiteral.BuildContext(plan.Hardening),
            ["pagination"] = PythonPaginationLiteral.BuildContext(plan.Pagination),
            ["discovered_urls"] = PythonDiscoveredUrlsLiteral.BuildContext(plan.DiscoveredUrls),
            ["preflight"] = PythonPreflightLiteral.BuildContext(plan.Preflight),
            ["external_config"] = PythonExternalConfigLiteral.BuildContext(plan.ExternalConfig),
            // Both rendered, only one is ever non-empty (see PythonOutputBlueprintLiteral.RenderTree).
            ["blueprint_mapping_enabled"] = plan.OutputBlueprint?.SchemaKind == OutputBlueprintSchemaKind.Flat,
            ["blueprint_mapping_literal"] = PythonOutputBlueprintLiteral.Render(plan.OutputBlueprint),
            ["blueprint_tree_mapping_enabled"] = plan.OutputBlueprint?.SchemaKind == OutputBlueprintSchemaKind.Tree,
            ["blueprint_tree_mapping_literal"] = PythonOutputBlueprintLiteral.RenderTree(plan.OutputBlueprint),
        };
    }

    // Flat Fields (scraper.py.j2 / playwright_scraper.py.j2). frame_path is always included, though only the Browser
    // engine reads it, so the two engines' per-field shape cannot drift apart.
    public static Dictionary<string, object?> BuildFlatModeContext(ScrapingPlan plan)
    {
        var navigate = plan.Steps.OfType<NavigateStep>().Single();
        var extractSteps = plan.Steps.OfType<ExtractStep>().ToList();
        var fields = extractSteps
            .Select(step => new Dictionary<string, object?>
            {
                ["name"] = step.Name,
                ["selector"] = step.Selector,
                ["attribute"] = step.Attribute,
                ["frame_path"] = step.FramePath,
                ["transforms_literal"] = PythonFieldTransformLiteral.Render(step.Transforms),
                // Same always-present convention as PythonGroupTreeLiteral.RenderField, as plain values (bound through Scriban).
                ["download"] = step.Download,
                ["max_download_size_bytes"] = step.MaxDownloadSizeBytes,
                ["allowed_content_types"] = step.AllowedContentTypes ?? new List<string>(),
                ["hidden_from_output"] = step.HiddenFromOutput,
            })
            .ToList();

        return new Dictionary<string, object?>
        {
            ["urls"] = navigate.Urls,
            ["fields"] = fields,
            ["script_filename"] = plan.ScriptFileName,
            ["output_filename"] = plan.OutputFileBaseName,
            ["output_is_json"] = plan.OutputFormat == OutputFormat.Json,
            ["output_is_sqlite"] = plan.OutputFormat == OutputFormat.Sqlite,
            ["output_is_xlsx"] = plan.OutputFormat == OutputFormat.Xlsx,
            // Gates the download helper's conditional imports.
            ["download_enabled"] = extractSteps.Any(step => step.Download),
            ["change_detection"] = PythonChangeDetectionLiteral.BuildContext(plan.ChangeDetection),
            ["proxy"] = PythonProxyLiteral.BuildContext(plan.Proxy),
            ["request_delay"] = PythonRequestDelayLiteral.BuildContext(plan),
            ["robots_check"] = PythonRobotsDisallowLiteral.BuildContext(plan),
            ["append_output"] = plan.AppendsOutput,
            ["retry"] = PythonRetryLiteral.BuildContext(plan.Retry),
            ["request_headers"] = PythonRequestHeadersLiteral.BuildContext(plan.Headers),
            ["text_selector"] = PythonTextSelectorLiteral.BuildContext(plan),
            ["dedup"] = PythonDeduplicationLiteral.BuildContext(plan.Deduplication),
            ["hardening"] = PythonHardeningLiteral.BuildContext(plan.Hardening),
            ["pagination"] = PythonPaginationLiteral.BuildContext(plan.Pagination),
            ["discovered_urls"] = PythonDiscoveredUrlsLiteral.BuildContext(plan.DiscoveredUrls),
            ["preflight"] = PythonPreflightLiteral.BuildContext(plan.Preflight),
            ["external_config"] = PythonExternalConfigLiteral.BuildContext(plan.ExternalConfig),
            ["blueprint_mapping_literal"] = PythonOutputBlueprintLiteral.Render(plan.OutputBlueprint),
        };
    }

    // Blocks mode (scraper_blocks / playwright_scraper_blocks). Each engine still computes change_detection_any itself
    // where it needs it standalone.
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
            ["request_delay"] = PythonRequestDelayLiteral.BuildContext(plan),
            ["robots_check"] = PythonRobotsDisallowLiteral.BuildContext(plan),
            ["append_output"] = plan.AppendsOutput,
            ["retry"] = PythonRetryLiteral.BuildContext(plan.Retry),
            ["request_headers"] = PythonRequestHeadersLiteral.BuildContext(plan.Headers),
            ["text_selector"] = PythonTextSelectorLiteral.BuildContext(plan),
            ["pagination"] = PythonPaginationLiteral.BuildContext(plan.Pagination),
            ["script_filename"] = plan.ScriptFileName,
        };
    }
}
