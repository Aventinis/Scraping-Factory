using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Companion.Endpoints;

// Blocks mode: independent extraction blocks (flat or container), each with its own output file, sharing this request's
// navigation, browser actions, proxy, session and pagination. Still ONE plan, script and verification subprocess, so it goes
// through the ordinary GenerateScript; only the verification checks one file per block.
public static partial class GenerateEndpoint
{
    private static async Task<IResult> GenerateBlocks(
        ScrapingConfig config, List<ExtractionBlockConfig> blocks, LanguageModuleRegistry registry, HttpContext httpContext)
    {
        var requestError = ValidateBlocksRequest(config, blocks);
        if (requestError is not null)
            return Results.BadRequest(new { error = requestError });

        var (plan, script, validationError, generatorError) = GenerateScript(config, registry);
        if (validationError is not null)
            return Results.BadRequest(new { error = validationError });
        if (generatorError is not null)
            return Results.UnprocessableEntity(new { error = generatorError });

        var outputSpecs = plan!.Steps.OfType<ExtractionBlockStep>().Single().Blocks
            .Select(b => new BlockOutputSpec(b.Name, b.OutputFormat, b.OutputFileBaseName))
            .ToList();
        var extraTimeoutMs = VerificationTimeEstimator.EstimateExtraMs(plan);
        var verificationEnv = FillVerificationValues.Filter(config.BrowserActions, config.VerificationValues, requestHeaders: config.Headers);

        ScriptVerificationResult verification;
        var skipReason = VerificationPolicy.SkipReason(config, extraTimeoutMs);
        if (skipReason is not null)
        {
            httpContext.Response.Headers[VerificationPolicy.SkippedHeader] = skipReason;
            verification = new ScriptVerificationResult
            {
                Success = true,
                Blocks = outputSpecs.Select(spec => new BlockVerificationResult { Name = spec.Name }).ToList(),
            };
        }
        else
        {
            var verifier = registry.ResolveScriptVerifier("python");
            verification = await verifier.VerifyBlocksAsync(
                script!, outputSpecs, TimeSpan.FromMilliseconds(extraTimeoutMs),
                verificationEnv.Count > 0 ? verificationEnv : null,
                config.IncludePreview == true, config.IncludeOutputFile == true);
            if (!verification.Success)
                return Results.UnprocessableEntity(new { error = verification.Error ?? "Script verification failed." });
        }

        if (config.IncludePreview != true && config.IncludeOutputFile != true)
            return Results.Text(script!, "text/plain");

        return Results.Json(new
        {
            script,
            blocks = verification.Blocks!.Select(b => new
            {
                name = b.Name,
                preview = b.Preview,
                outputFile = b.OutputFileContent is not null
                    ? new { fileName = b.OutputFileName, content = b.OutputFileContent }
                    : null,
            }),
        });
    }

    // ChangeDetection and Hardening are per block (set them on the block); the other options are not designed for more
    // than one output yet and are rejected rather than guessed at.
    private static string? ValidateBlocksRequest(ScrapingConfig config, List<ExtractionBlockConfig> blocks)
    {
        if (config.Fields.Count > 0 || config.Groups is { Count: > 0 } || config.Api is not null || config.Combined is { Count: > 0 })
            return "Blocks is mutually exclusive with Fields, Groups, Api and Combined.";
        if (config.ChangeDetection is not null)
            return "ChangeDetection is not supported on a Blocks request — set it on each block's own config instead.";
        if (config.Hardening is { Count: > 0 })
            return "Hardening is not supported on a Blocks request — set it on each block's own config instead.";
        if (config.ExternalConfig == true)
            return "ExternalConfig is not supported together with Blocks.";
        if (config.OutputBlueprint is not null)
            return "OutputBlueprint is not supported together with Blocks.";
        if (config.DiscoveredUrls is not null)
            return "DiscoveredUrls is not supported together with Blocks.";
        if (config.Preflight == true)
            return "Preflight is not supported together with Blocks.";
        if (config.Deduplication is not null)
            return "Deduplication is not supported together with Blocks.";

        for (var i = 0; i < blocks.Count; i++)
        {
            var blockError = ValidateBlock(blocks[i], i + 1);
            if (blockError is not null)
                return blockError;
        }

        return null;
    }

    private static string? ValidateBlock(ExtractionBlockConfig block, int number)
    {
        var hasFields = block.Fields is { Count: > 0 };
        var hasGroups = block.Groups is { Count: > 0 };
        if (hasFields == hasGroups)
            return $"Block #{number} needs exactly one of Fields or Groups.";
        // The Blocks templates do not handle downloads, blank selectors (derived fields) or hidden fields.
        if (block.Fields?.Any(f => f.Download) == true)
            return $"Block #{number}: Download is not supported on a block's own fields yet.";
        if (block.Fields?.Any(f => string.IsNullOrWhiteSpace(f.Selector) || f.HiddenFromOutput) == true)
            return $"Block #{number}: combineFields/splitField-derived fields and HiddenFromOutput are not supported on a block's own fields yet.";
        return null;
    }
}
