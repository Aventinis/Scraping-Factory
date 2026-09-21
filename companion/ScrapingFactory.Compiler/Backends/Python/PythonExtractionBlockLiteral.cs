using System.Text;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Issue #182: serializes ScrapingPlan's per-block extraction list
// (ExtractionBlockStep.Blocks) into one Python list-of-dicts literal, BLOCKS,
// consumed at runtime by scraper_blocks.py.j2/playwright_scraper_blocks.py.j2.
// Each block embeds its own shape — flat SELECTORS/ATTRIBUTES/TRANSFORMS
// dicts (built inline here, mirroring how PythonCodeGenerator's own `fields`
// context feeds scraper.py.j2's Scriban loop, just pre-rendered to Python
// source instead) or a group tree literal exactly like PythonGroupTreeLiteral
// already builds for single-shape Container-Mode — plus its own output
// path/format and its own Hardening/ChangeDetection config, reusing
// PythonHardeningLiteral/PythonChangeDetectionLiteral's existing
// BuildContext *_literal fragments verbatim (via `dynamic`, since both
// return an anonymous type) rather than re-deriving them a second time.
internal static class PythonExtractionBlockLiteral
{
    public static string Render(IReadOnlyList<PlanExtractionBlock> blocks)
    {
        if (blocks.Count == 0) return "[]";
        var sb = new StringBuilder();
        sb.Append("[\n");
        foreach (var block in blocks)
            sb.Append("    ").Append(RenderBlock(block)).Append(",\n");
        sb.Append(']');
        return sb.ToString();
    }

    private static string RenderBlock(PlanExtractionBlock block)
    {
        var isGroup = block.Groups is { Count: > 0 };
        var extension = block.OutputFormat == OutputFormat.Json ? "json" : isGroup ? "xml" : "csv";
        var outputPath = $"{block.OutputFileBaseName}.{extension}";

        var shapePart = isGroup
            ? $"\"shape\": {PythonLiteral.Str("group")}, \"groups\": {PythonGroupTreeLiteral.Render(block.Groups!, indent: 0)}"
            : BuildFlatShapePart(block.Fields ?? []);

        return $$"""
            {"name": {{PythonLiteral.Str(block.Name)}}, "output_path": {{PythonLiteral.Str(outputPath)}}, "output_is_json": {{PythonBool(block.OutputFormat == OutputFormat.Json)}}, {{shapePart}}, "hardening": {{RenderHardeningDict(block.Hardening)}}, "change_detection": {{RenderChangeDetectionDict(block.ChangeDetection)}}}
            """.ReplaceLineEndings("");
    }

    private static string BuildFlatShapePart(List<ExtractStep> fields)
    {
        var selectors = "{" + string.Join(", ", fields.Select(f => $"{PythonLiteral.Str(f.Name)}: {PythonLiteral.Str(f.Selector)}")) + "}";
        var attributes = "{" + string.Join(", ", fields.Where(f => f.Attribute is not null)
            .Select(f => $"{PythonLiteral.Str(f.Name)}: {PythonLiteral.Str(f.Attribute!)}")) + "}";
        var transforms = "{" + string.Join(", ", fields.Select(f => $"{PythonLiteral.Str(f.Name)}: {PythonFieldTransformLiteral.Render(f.Transforms)}")) + "}";
        // Browser engine only (playwright_scraper_blocks.py.j2) — the Static
        // engine's own blocks template never reads "frame_paths" at all,
        // same as SELECTORS/ATTRIBUTES/FRAME_PATHS' single-shape counterparts
        // in scraper.py.j2 vs. playwright_scraper.py.j2.
        var framePaths = "{" + string.Join(", ", fields.Where(f => f.FramePath is { Count: > 0 })
            .Select(f => $"{PythonLiteral.Str(f.Name)}: {PythonLiteral.StrList(f.FramePath!)}")) + "}";
        var fieldOrder = PythonLiteral.StrList(fields.Select(f => f.Name));
        return $"\"shape\": {PythonLiteral.Str("flat")}, \"field_order\": {fieldOrder}, \"selectors\": {selectors}, \"attributes\": {attributes}, \"transforms\": {transforms}, \"frame_paths\": {framePaths}";
    }

    // BuildContext returns an anonymous type (internal to this assembly by
    // construction) — `dynamic` lets these two helpers read its fields
    // without PythonHardeningLiteral/PythonChangeDetectionLiteral needing a
    // named return type solely for this one extra caller.
    private static string RenderHardeningDict(List<HardeningCheck>? hardening)
    {
        dynamic ctx = PythonHardeningLiteral.BuildContext(hardening);
        return $$"""{"enabled": {{PythonBool(ctx.enabled)}}, "has_baseline": {{PythonBool(ctx.has_baseline)}}, "checks": {{ctx.checks_literal}}}""";
    }

    private static string RenderChangeDetectionDict(ChangeDetectionConfig? changeDetection)
    {
        dynamic ctx = PythonChangeDetectionLiteral.BuildContext(changeDetection);
        return $$"""
            {"enabled": {{PythonBool(ctx.enabled)}}, "notify": {{ctx.notify_literal}}, "smtp_host_env_var": {{ctx.smtp_host_env_var_literal}}, "smtp_port_env_var": {{ctx.smtp_port_env_var_literal}}, "smtp_username_env_var": {{ctx.smtp_username_env_var_literal}}, "smtp_password_env_var": {{ctx.smtp_password_env_var_literal}}, "from_env_var": {{ctx.from_env_var_literal}}, "to_env_var": {{ctx.to_env_var_literal}}, "webhook_url_env_var": {{ctx.webhook_url_env_var_literal}}}
            """.ReplaceLineEndings("");
    }

    private static string PythonBool(bool value) => value ? "True" : "False";
}
