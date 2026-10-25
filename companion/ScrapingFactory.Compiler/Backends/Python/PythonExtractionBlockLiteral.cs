using System.Text;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Serializes the per-block list into one Python literal, BLOCKS, consumed by the Blocks templates. Each block embeds
// its own shape (flat dicts built inline, or a group tree like PythonGroupTreeLiteral), its output path/format and its
// own hardening / change detection (reusing the other literal builders' output).
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
        // Blocks mode rejects a blank Selector earlier; the ?? "" only satisfies the nullable type.
        var selectors = "{" + string.Join(", ", fields.Select(f => $"{PythonLiteral.Str(f.Name)}: {PythonLiteral.Str(f.Selector ?? "")}")) + "}";
        var attributes = "{" + string.Join(", ", fields.Where(f => f.Attribute is not null)
            .Select(f => $"{PythonLiteral.Str(f.Name)}: {PythonLiteral.Str(f.Attribute!)}")) + "}";
        var transforms = "{" + string.Join(", ", fields.Select(f => $"{PythonLiteral.Str(f.Name)}: {PythonFieldTransformLiteral.Render(f.Transforms)}")) + "}";
        // Browser engine only; the Static blocks template never reads "frame_paths".
        var framePaths = "{" + string.Join(", ", fields.Where(f => f.FramePath is { Count: > 0 })
            .Select(f => $"{PythonLiteral.Str(f.Name)}: {PythonLiteral.StrList(f.FramePath!)}")) + "}";
        var fieldOrder = PythonLiteral.StrList(fields.Select(f => f.Name));
        return $"\"shape\": {PythonLiteral.Str("flat")}, \"field_order\": {fieldOrder}, \"selectors\": {selectors}, \"attributes\": {attributes}, \"transforms\": {transforms}, \"frame_paths\": {framePaths}";
    }

    // BuildContext returns an anonymous type, so these helpers read it through `dynamic`.
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
