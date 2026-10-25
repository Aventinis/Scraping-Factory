using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Companion.Endpoints;

// Combined mode: independent component configs, each generated like a normal request, run by one wrapper script that merges
// their outputs. There is no single outer plan, so this does not go through ValidateModeExclusivity/GenerateScript for the
// outer request itself (PythonCombinedScriptGenerator renders the wrapper).
public static partial class GenerateEndpoint
{
    private static async Task<IResult> GenerateCombined(
        ScrapingConfig config, List<CombinedComponentConfig> combined, LanguageModuleRegistry registry, HttpContext httpContext)
    {
        var requestError = ValidateCombinedRequest(config, combined);
        if (requestError is not null)
            return Results.BadRequest(new { error = requestError });

        var componentNames = combined
            .Select((c, i) => string.IsNullOrWhiteSpace(c.Name) ? $"component_{i + 1}" : c.Name.Trim())
            .ToList();
        var duplicateComponentNames = componentNames.GroupBy(n => n).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
        if (duplicateComponentNames.Count > 0)
            return Results.BadRequest(new { error = $"Duplicate component names: {string.Join(", ", duplicateComponentNames)}." });

        var componentScripts = new List<(string Name, string Script)>();
        var mergedVerificationValues = new Dictionary<string, string>();
        var componentExtraTimeoutMs = 0L;

        for (var i = 0; i < combined.Count; i++)
        {
            var component = combined[i];
            var componentName = componentNames[i];

            var componentExclusivityError = ValidateModeExclusivity(component.Config);
            if (componentExclusivityError is not null)
                return Results.BadRequest(new { error = $"Component '{componentName}': {componentExclusivityError}" });

            var (componentPlan, componentScript, componentValidationError, componentGeneratorError) =
                GenerateScript(component.Config, registry, plan => plan.With(OutputFormat.Json, "output"));
            if (componentValidationError is not null)
                return Results.BadRequest(new { error = $"Component '{componentName}': {componentValidationError}" });
            if (componentGeneratorError is not null)
                return Results.UnprocessableEntity(new { error = $"Component '{componentName}': {componentGeneratorError}" });

            componentScripts.Add((componentName, componentScript!));
            componentExtraTimeoutMs += VerificationTimeEstimator.EstimateExtraMs(componentPlan!);

            // Merged flat (a later component wins a name clash; fine for one-time test values). Only one outer subprocess is
            // spawned, and the per-component subprocesses it starts inherit its environment.
            foreach (var (name, value) in FillVerificationValues.Filter(component.Config.BrowserActions, component.VerificationValues, requestHeaders: component.Config.Headers))
                mergedVerificationValues[name] = value;
        }

        var scriptFileName = FileNameSanitizer.SanitizeBaseName(config.ScriptFileName, "scraper");
        var outputFileBaseName = FileNameSanitizer.SanitizeBaseName(config.OutputFileName, "output");
        var script = PythonCombinedScriptGenerator.Generate(componentScripts, scriptFileName, outputFileBaseName);

        // The base timeout has to cover all components running one after another; many slow ones may need
        // VerifierTimeoutSeconds raised (CompanionBackendOverrides).
        ScriptVerificationResult verification;
        var skipReason = VerificationPolicy.SkipReason(config, componentExtraTimeoutMs);
        if (skipReason is not null)
        {
            httpContext.Response.Headers[VerificationPolicy.SkippedHeader] = skipReason;
            verification = new ScriptVerificationResult { Success = true };
        }
        else
        {
            var verifier = registry.ResolveScriptVerifier("python");
            verification = await verifier.VerifyAsync(
                script, OutputFormat.Json, outputFileBaseName, TimeSpan.FromMilliseconds(componentExtraTimeoutMs),
                mergedVerificationValues.Count > 0 ? mergedVerificationValues : null,
                config.IncludePreview == true, config.IncludeOutputFile == true);
            if (!verification.Success)
                return Results.UnprocessableEntity(new { error = verification.Error ?? "Script verification failed." });
        }

        if (config.IncludePreview != true && config.IncludeOutputFile != true)
            return Results.Text(script, "text/plain");

        return Results.Json(new
        {
            script,
            preview = verification.Preview,
            outputFile = verification.OutputFileContent is not null
                ? new { fileName = verification.OutputFileName, content = verification.OutputFileContent }
                : null,
        });
    }

    // Every per-run option belongs to a component's own config; the outer request only lists the components.
    private static string? ValidateCombinedRequest(ScrapingConfig config, List<CombinedComponentConfig> combined)
    {
        if (config.Fields.Count > 0 || config.Groups is { Count: > 0 } || config.Api is not null)
            return "Combined is mutually exclusive with Fields, Groups and Api.";

        var unsupported = new (string Option, bool IsSet)[]
        {
            (nameof(config.AdditionalUrls), config.AdditionalUrls is { Count: > 0 }),
            (nameof(config.Pagination), config.Pagination is not null),
            (nameof(config.DiscoveredUrls), config.DiscoveredUrls is not null),
            (nameof(config.Preflight), config.Preflight == true),
            (nameof(config.Headers), config.Headers is { Count: > 0 }),
            (nameof(config.BrowserActions), config.BrowserActions is { Count: > 0 }),
            (nameof(config.ChangeDetection), config.ChangeDetection is not null),
            (nameof(config.Proxy), config.Proxy is not null),
            (nameof(config.RequestDelay), config.RequestDelay is not null),
            (nameof(config.RespectRobotsDelay), config.RespectRobotsDelay == true),
            (nameof(config.AppendOutput), config.AppendOutput == true),
            (nameof(config.RobotsDisallow), config.RobotsDisallow is not null),
            (nameof(config.Retry), config.Retry is not null),
            (nameof(config.Hardening), config.Hardening is { Count: > 0 }),
            (nameof(config.Deduplication), config.Deduplication is not null),
            (nameof(config.PersistentSession), config.PersistentSession == true),
            (nameof(config.ExternalConfig), config.ExternalConfig == true),
            (nameof(config.OutputBlueprint), config.OutputBlueprint is not null),
        };
        var first = unsupported.FirstOrDefault(entry => entry.IsSet);
        if (first.Option is not null)
            return $"{first.Option} is not supported on a Combined request — set it on each component's own config instead.";

        if (combined.Count < 2)
            return "Combined requires at least 2 components.";
        if (combined.Any(c => c.Config.Combined is { Count: > 0 }))
            return "Nested Combined configurations are not supported.";

        return null;
    }
}
