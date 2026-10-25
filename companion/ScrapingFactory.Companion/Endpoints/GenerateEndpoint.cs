using Microsoft.AspNetCore.Mvc;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Companion.Endpoints;

// POST /generate: builds the script from the wire config, runs it once as a trial (unless that is skipped, see
// VerificationPolicy) and only then returns it. Three request shapes: one extraction (this file), Combined and Blocks (the
// partial files next to it).
public static partial class GenerateEndpoint
{
    public static void MapGenerateEndpoint(this IEndpointRouteBuilder app) =>
        app.MapPost("/generate", async ([FromBody] ScrapingConfig? config, LanguageModuleRegistry registry, HttpContext httpContext) =>
        {
            if (config is null)
                return Results.BadRequest(new { error = "Invalid ScrapingConfig: Url and at least one Field, Group or Api are required." });

            if (config.Combined is { Count: > 0 } combined)
                return await GenerateCombined(config, combined, registry, httpContext);
            if (config.Blocks is { Count: > 0 } blocks)
                return await GenerateBlocks(config, blocks, registry, httpContext);
            return await GenerateSingle(config, registry, httpContext);
        });

    private static async Task<IResult> GenerateSingle(ScrapingConfig config, LanguageModuleRegistry registry, HttpContext httpContext)
    {
        var exclusivityError = ValidateModeExclusivity(config);
        if (exclusivityError is not null)
            return Results.BadRequest(new { error = exclusivityError });

        var (planOrNull, script, validationError, generatorError) = GenerateScript(config, registry);
        if (validationError is not null)
            return Results.BadRequest(new { error = validationError });
        if (generatorError is not null)
            return Results.UnprocessableEntity(new { error = generatorError });
        // GenerateScript returns a plan exactly when both errors are null; the compiler cannot see across the tuple.
        var plan = planOrNull!;

        // The trial run proves the exact artifact the user downloads works, which a static selector check could not.
        // Scroll/wait steps and browser-discovery actions can exceed the verifier's base timeout, so their cost is added.
        var extraTimeoutMs = VerificationTimeEstimator.EstimateExtraMs(plan);

        // One-time test values for Fill actions, headers and the API bootstrap: used only by this trial subprocess.
        var verificationEnv = FillVerificationValues.Filter(config.BrowserActions, config.VerificationValues, config.Api, config.Headers);

        ScriptVerificationResult verification;
        var skipReason = VerificationPolicy.SkipReason(config, extraTimeoutMs);
        if (skipReason is not null)
        {
            httpContext.Response.Headers[VerificationPolicy.SkippedHeader] = skipReason;
            verification = new ScriptVerificationResult { Success = true };
        }
        else
        {
            var verifier = registry.ResolveScriptVerifier("python");
            verification = await verifier.VerifyAsync(
                script!, plan.OutputFormat, plan.OutputFileBaseName, TimeSpan.FromMilliseconds(extraTimeoutMs),
                verificationEnv.Count > 0 ? verificationEnv : null, config.IncludePreview == true, config.IncludeOutputFile == true);
            if (!verification.Success)
                return Results.UnprocessableEntity(new { error = verification.Error ?? "Script verification failed." });
        }

        // A JSON envelope only for callers that asked for the preview or the full output; everyone else gets plain text.
        if (config.IncludePreview != true && config.IncludeOutputFile != true)
            return Results.Text(script!, "text/plain");

        return Results.Json(new
        {
            script,
            preview = verification.Preview,
            outputFile = verification.OutputFileContent is not null
                ? new { fileName = verification.OutputFileName, content = verification.OutputFileContent, encoding = verification.OutputFileEncoding }
                : null,
        });
    }

    // Fields, Groups and Api are strictly separate; mixing two would leave the output format ambiguous. Shared by a
    // single request and, per component, a Combined request. Returns null when the config may proceed.
    private static string? ValidateModeExclusivity(ScrapingConfig config)
    {
        var hasFields = config.Fields.Count > 0;
        var hasGroups = config.Groups is { Count: > 0 };
        var hasApi = config.Api is not null;
        if (string.IsNullOrWhiteSpace(config.Url) || (!hasFields && !hasGroups && !hasApi))
            return "Url and at least one Field, Group or Api are required.";

        if (hasFields && hasGroups) return "Fields and Groups are mutually exclusive.";
        if (hasFields && hasApi) return "Fields and Api are mutually exclusive.";
        if (hasGroups && hasApi) return "Groups and Api are mutually exclusive.";

        // API mode builds its own request URL and never reads a page-scraping start URL, so these would silently do nothing.
        if (hasApi && config.AdditionalUrls is { Count: > 0 })
            return "AdditionalUrls and Api are mutually exclusive.";
        if (hasApi && config.Pagination is not null)
            return "Pagination and Api are mutually exclusive.";
        if (hasApi && config.DiscoveredUrls is not null)
            return "DiscoveredUrls and Api are mutually exclusive.";
        if (hasApi && config.Preflight == true)
            return "Preflight and Api are mutually exclusive.";
        if (hasApi && config.Headers is { Count: > 0 })
            return "Headers and Api are mutually exclusive — set ApiConfig.Headers instead.";

        return null;
    }

    // Wire config -> canonical plan -> script. transformPlan (Combined only) runs after validation to force a component's
    // output to Json and a fixed file name. Plan is non-null exactly when ValidationError and GeneratorError are both null.
    private static (ScrapingPlan? Plan, string? Script, string? ValidationError, string? GeneratorError) GenerateScript(
        ScrapingConfig config, LanguageModuleRegistry registry, Func<ScrapingPlan, ScrapingPlan>? transformPlan = null)
    {
        var plan = ScrapingPlanBuilder.Build(config);

        // Fast structural checks before paying for codegen and a subprocess; selector syntax is only proven by the trial run.
        var planValidation = ScrapingPlanValidator.Validate(plan);
        if (!planValidation.Success)
            return (null, null, planValidation.Error, null);

        if (transformPlan is not null)
            plan = transformPlan(plan);

        // Python is the only target language for now; the engine comes from the request. A plan whose engine has no
        // generator is reported like any other config-level rejection.
        ICodeGenerator generator;
        try
        {
            generator = registry.ResolveCodeGenerator("python", plan.Engine);
        }
        catch (InvalidOperationException ex)
        {
            return (null, null, null, ex.Message);
        }

        return (plan, generator.Generate(plan), null, null);
    }
}
