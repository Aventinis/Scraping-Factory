using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using ScrapingFactory.Companion;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.UseUrls(CompanionHostOptions.BuildListenUrl(builder.Configuration));

builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy => policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
    // Required for Container-Mode: List<ContainerNode> mixes GroupNode and
    // DataFieldNode, which System.Text.Json can't (de)serialize through the
    // abstract base type on its own — see ContainerNodeJsonConverter.
    options.SerializerOptions.Converters.Add(new ContainerNodeJsonConverter());
    // Same reason, one level down: API-Mode's nested tree shape (Issue #54,
    // ApiGroup.Children: List<ApiNode>) needs the same treatment — see
    // ApiNodeJsonConverter.
    options.SerializerOptions.Converters.Add(new ApiNodeJsonConverter());
    // Same reason again for API-Mode's request-body tree (Issue #55,
    // ApiBodyObject.Properties/ApiBodyArray.Items: .../ApiBodyNode) — see
    // ApiBodyNodeJsonConverter.
    options.SerializerOptions.Converters.Add(new ApiBodyNodeJsonConverter());
});

builder.Services.AddSingleton(new LanguageModuleRegistry(CompanionBackendOverrides.Build(builder.Configuration)));

// Issue #141: registered as a type (not a pre-built instance like
// LanguageModuleRegistry above) so DI only constructs it — and only then
// resolves/creates the SQLite file — on the first actual /configs request;
// /health and /generate never touch it.
builder.Services.AddSingleton<SavedConfigStore>();

// Issue #191: same lazy-construction reasoning as SavedConfigStore above,
// its own independent store/SQLite file — see OutputBlueprintStore's own
// doc comment for why this isn't just a third table there.
builder.Services.AddSingleton<OutputBlueprintStore>();

var app = builder.Build();

app.UseCors();

app.MapGet("/health", () => Results.Ok());

// Issue #141: local SQLite-backed configuration history — save/list/load/
// delete past per-site configs, so a repeatedly-scraped site's setup doesn't
// have to be rebuilt (or manually managed as a downloaded JSON export, see
// buildConfigExport on the extension side) every time. Purely local/
// additive: no data ever leaves the user's machine, same trust boundary as
// the rest of the companion<->extension communication.
app.MapPost("/configs", (SaveConfigRequest? request, SavedConfigStore store) =>
{
    var url = request?.Url?.Trim();
    var name = request?.Name?.Trim();
    if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(name) ||
        request!.Config.ValueKind != System.Text.Json.JsonValueKind.Object)
    {
        return Results.BadRequest(new { error = "Url, Name and a Config object are required." });
    }

    var saved = store.Save(url, name, request.Config.GetRawText());
    return Results.Created($"/configs/{saved.Id}", saved);
});

// Issue #239: the url query parameter is now optional — omitting it lists
// saved configurations across every host, needed by Combined mode's
// component picker (a component can come from any previously-scraped site,
// not just the current tab's hostname). Passing url keeps today's exact
// hostname-scoped behavior, fully backward compatible.
app.MapGet("/configs", (string? url, SavedConfigStore store) =>
    Results.Ok(string.IsNullOrWhiteSpace(url) ? store.ListAll() : store.ListByUrl(url)));

app.MapGet("/configs/{id:long}", (long id, SavedConfigStore store) =>
{
    var record = store.Get(id);
    if (record is null)
        return Results.NotFound(new { error = "Saved configuration not found." });

    return Results.Ok(new
    {
        record.Id,
        record.Url,
        record.Name,
        record.SavedAt,
        config = System.Text.Json.JsonDocument.Parse(record.ConfigJson).RootElement,
    });
});

app.MapDelete("/configs/{id:long}", (long id, SavedConfigStore store) =>
    store.Delete(id) ? Results.NoContent() : Results.NotFound(new { error = "Saved configuration not found." }));

// Issue #202: a saved run's actual output data, linked to an already-saved
// configuration — the "what did a previous run actually return" counterpart
// to /configs above. Explicit, opt-in "Save output" action mirroring "Save
// configuration"'s own opt-in nature, not automatic/implicit saving of every
// run. Same local/opt-in trust boundary as /configs — nothing here leaves
// the user's machine. Deliberately does not evaluate hardening checks
// against a saved output — that's its own issue (#207), since hardening
// today only ever runs live, inside the generated script itself.
app.MapPost("/configs/{configId:long}/outputs", (long configId, SaveOutputRequest? request, SavedConfigStore store) =>
{
    if (store.Get(configId) is null)
        return Results.NotFound(new { error = "Saved configuration not found." });

    var name = request?.Name?.Trim();
    var fileName = request?.FileName?.Trim();
    var content = request?.Content;
    if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(fileName) || string.IsNullOrEmpty(content))
        return Results.BadRequest(new { error = "Name, FileName and Content are required." });

    var saved = store.SaveOutput(configId, name, fileName, content);
    return Results.Created($"/configs/{configId}/outputs/{saved.Id}", saved);
});

app.MapGet("/configs/{configId:long}/outputs", (long configId, SavedConfigStore store) =>
{
    if (store.Get(configId) is null)
        return Results.NotFound(new { error = "Saved configuration not found." });

    return Results.Ok(store.ListOutputsByConfigId(configId));
});

app.MapGet("/configs/{configId:long}/outputs/{id:long}", (long configId, long id, SavedConfigStore store) =>
{
    var record = store.GetOutput(id);
    if (record is null || record.SavedConfigId != configId)
        return Results.NotFound(new { error = "Saved output not found." });

    return Results.Ok(record);
});

app.MapDelete("/configs/{configId:long}/outputs/{id:long}", (long configId, long id, SavedConfigStore store) =>
{
    var record = store.GetOutput(id);
    if (record is null || record.SavedConfigId != configId)
        return Results.NotFound(new { error = "Saved output not found." });

    return store.DeleteOutput(id) ? Results.NoContent() : Results.NotFound();
});

// Issue #191: Output Blueprints — a small local CRUD store of named,
// reusable target field-name lists, entirely independent of any one saved
// configuration/site (unlike /configs above, there's no url-scoping here).
// A configuration's own OutputBlueprint mapping (IR/OutputBlueprintMapping.cs)
// never round-trips through these endpoints at generate time — the
// extension resolves a blueprint's field list from here once, when the user
// actually builds the mapping, and sends the resolved mapping verbatim with
// the /generate request itself (see ScrapingPlanBuilder's own doc comment).
static List<string>? NormalizeBlueprintFieldNames(List<string>? fieldNames) =>
    fieldNames?.Select(name => name.Trim()).Where(name => name.Length > 0).ToList();

app.MapPost("/blueprints", (SaveBlueprintRequest? request, OutputBlueprintStore store) =>
{
    var name = request?.Name?.Trim();
    var fieldNames = NormalizeBlueprintFieldNames(request?.FieldNames);
    if (string.IsNullOrWhiteSpace(name) || fieldNames is not { Count: > 0 })
        return Results.BadRequest(new { error = "Name and at least one field name are required." });
    if (fieldNames.Distinct().Count() != fieldNames.Count)
        return Results.BadRequest(new { error = "Field names must be unique." });

    var saved = store.Save(name, fieldNames);
    return Results.Created($"/blueprints/{saved.Id}", saved);
});

app.MapGet("/blueprints", (OutputBlueprintStore store) => Results.Ok(store.ListAll()));

app.MapGet("/blueprints/{id:long}", (long id, OutputBlueprintStore store) =>
{
    var record = store.Get(id);
    return record is null ? Results.NotFound(new { error = "Output blueprint not found." }) : Results.Ok(record);
});

app.MapPut("/blueprints/{id:long}", (long id, SaveBlueprintRequest? request, OutputBlueprintStore store) =>
{
    if (store.Get(id) is null)
        return Results.NotFound(new { error = "Output blueprint not found." });

    var name = request?.Name?.Trim();
    var fieldNames = NormalizeBlueprintFieldNames(request?.FieldNames);
    if (string.IsNullOrWhiteSpace(name) || fieldNames is not { Count: > 0 })
        return Results.BadRequest(new { error = "Name and at least one field name are required." });
    if (fieldNames.Distinct().Count() != fieldNames.Count)
        return Results.BadRequest(new { error = "Field names must be unique." });

    store.Update(id, name, fieldNames);
    return Results.Ok(new { id, name, fieldNames });
});

app.MapDelete("/blueprints/{id:long}", (long id, OutputBlueprintStore store) =>
    store.Delete(id) ? Results.NoContent() : Results.NotFound(new { error = "Output blueprint not found." }));

// Flat-Mode (Fields → Csv), Container-Mode (Groups → Xml) and API-Mode
// (Api → Csv) are strictly separate — mixing any two in one request would
// leave it ambiguous which extraction phase (and OutputFormat) the caller
// wants. Extracted so both a normal single-mode request and, per component,
// a Combined-mode request (Issue #239) run the exact same checks — returns
// null when config is structurally fine to proceed with.
static string? ValidateModeExclusivity(ScrapingConfig config)
{
    var hasFields = config.Fields.Count > 0;
    var hasGroups = config.Groups is { Count: > 0 };
    var hasApi = config.Api is not null;
    if (string.IsNullOrWhiteSpace(config.Url) || (!hasFields && !hasGroups && !hasApi))
        return "Url and at least one Field, Group or Api are required.";

    if (hasFields && hasGroups) return "Fields and Groups are mutually exclusive.";
    if (hasFields && hasApi) return "Fields and Api are mutually exclusive.";
    if (hasGroups && hasApi) return "Groups and Api are mutually exclusive.";

    // Issue #83: Api-Mode builds its own request URL from UrlTemplate/
    // Parameters and never reads the page-scraping start URL at all — an
    // AdditionalUrls list here would silently do nothing, so it's rejected
    // outright instead, same as the other three mode combinations above.
    if (hasApi && config.AdditionalUrls is { Count: > 0 })
        return "AdditionalUrls and Api are mutually exclusive.";

    // Issue #191: OutputBlueprint only makes sense for flat-shaped output —
    // a tree (Container-Mode, or Api's own Groups shape) doesn't have a flat
    // row of named columns to remap. Rejected outright rather than silently
    // ignored, same reasoning as AdditionalUrls-vs-Api above.
    if (config.OutputBlueprint is not null)
    {
        if (hasGroups)
            return "OutputBlueprint and Groups are mutually exclusive — output blueprints are only supported for flat-shaped output.";
        if (hasApi && config.Api!.Groups is { Count: > 0 })
            return "OutputBlueprint is not supported for Api mode's tree response shape (Groups) — only the flat ItemsPath/Fields shape.";
    }

    // Issue #174: same reasoning as AdditionalUrls above — Api-Mode never
    // reads the page-scraping start URL, so pagination would silently do
    // nothing there.
    if (hasApi && config.Pagination is not null)
        return "Pagination and Api are mutually exclusive.";

    return null;
}

// Wire format (Fields/Groups) is unchanged; internally it's compiled into
// the canonical Steps-based ScrapingPlan that backends actually consume.
// Extracted (Issue #239) so both a normal single-mode request and, per
// component, a Combined-mode request share the exact same
// build→validate→resolve-generator→render sequence instead of duplicating
// it. transformPlan (used only by Combined mode, to force a component's
// plan to Json/a fixed output name after its own real shape/engine has
// already been validated) runs between validation and generation.
static (ScrapingPlan? Plan, string? Script, string? ValidationError, string? GeneratorError) GenerateScript(
    ScrapingConfig config, LanguageModuleRegistry registry, Func<ScrapingPlan, ScrapingPlan>? transformPlan = null)
{
    var plan = ScrapingPlanBuilder.Build(config);

    // Fast structural checks (malformed URL, duplicate/empty field names)
    // before paying for codegen and a real subprocess/network round trip.
    // Deliberately doesn't validate CSS selector syntax — that's still only
    // proven by actually running the script below.
    var planValidation = ScrapingPlanValidator.Validate(plan);
    if (!planValidation.Success)
        return (null, null, planValidation.Error, null);

    if (transformPlan is not null)
        plan = transformPlan(plan);

    // v1 only ships Python backends, so the language id is fixed here;
    // a later phase will let ScrapingConfig pick the target language. The
    // engine (Static requests+BeautifulSoup vs. Browser Playwright vs. Api)
    // comes straight from the request. Resolution can fail for a plan whose
    // engine has no registered generator yet (e.g. Api-Mode before Phase 2's
    // PythonApiCodeGenerator lands) — reported the same way as any other
    // config-level rejection instead of an unhandled 500.
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

app.MapPost("/generate", async ([FromBody] ScrapingConfig? config, LanguageModuleRegistry registry) =>
{
    if (config is null)
    {
        return Results.BadRequest(new
        {
            error = "Invalid ScrapingConfig: Url and at least one Field, Group or Api are required.",
        });
    }

    // Combined mode (Issue #239): a list of fully independent component
    // configs to run and merge — mutually exclusive with Fields/Groups/Api
    // and with every other cross-cutting field on THIS (outer) config, all
    // of which are component-level concerns only for v1 (each component's
    // own Config carries its own AdditionalUrls/Pagination/BrowserActions/
    // ChangeDetection/Proxy/Hardening/PersistentSession/ExternalConfig).
    // Handled as its own branch rather than through
    // ValidateModeExclusivity/GenerateScript for the outer request itself,
    // since there's no single outer ScrapingPlan/OutputFormat/Engine to
    // build for "run N independent scrapes and merge them" — see
    // PythonCombinedScriptGenerator.
    if (config.Combined is { Count: > 0 } combined)
    {
        if (config.Fields.Count > 0 || config.Groups is { Count: > 0 } || config.Api is not null)
            return Results.BadRequest(new { error = "Combined is mutually exclusive with Fields, Groups and Api." });
        if (config.AdditionalUrls is { Count: > 0 })
            return Results.BadRequest(new { error = "AdditionalUrls is not supported on a Combined request — set it on each component's own config instead." });
        if (config.Pagination is not null)
            return Results.BadRequest(new { error = "Pagination is not supported on a Combined request — set it on each component's own config instead." });
        if (config.BrowserActions is { Count: > 0 })
            return Results.BadRequest(new { error = "BrowserActions is not supported on a Combined request — set it on each component's own config instead." });
        if (config.ChangeDetection is not null)
            return Results.BadRequest(new { error = "ChangeDetection is not supported on a Combined request — set it on each component's own config instead." });
        if (config.Proxy is not null)
            return Results.BadRequest(new { error = "Proxy is not supported on a Combined request — set it on each component's own config instead." });
        if (config.Hardening is { Count: > 0 })
            return Results.BadRequest(new { error = "Hardening is not supported on a Combined request — set it on each component's own config instead." });
        if (config.PersistentSession == true)
            return Results.BadRequest(new { error = "PersistentSession is not supported on a Combined request — set it on each component's own config instead." });
        if (config.ExternalConfig == true)
            return Results.BadRequest(new { error = "ExternalConfig is not supported on a Combined request — set it on each component's own config instead." });
        if (config.OutputBlueprint is not null)
            return Results.BadRequest(new { error = "OutputBlueprint is not supported on a Combined request — set it on each component's own config instead." });

        if (combined.Count < 2)
            return Results.BadRequest(new { error = "Combined requires at least 2 components." });
        if (combined.Any(c => c.Config.Combined is { Count: > 0 }))
            return Results.BadRequest(new { error = "Nested Combined configurations are not supported." });

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
            componentExtraTimeoutMs += componentPlan!.Steps.OfType<ScrollStep>().Sum(step => (long)step.MaxIterations * step.WaitAfterMs);

            // See CombinedComponentConfig.VerificationValues's own doc
            // comment — merged flat across every component (a name
            // collision silently lets the later component's value win,
            // acceptable for one-time trial-run-only test values), since
            // the verifier below only ever spawns ONE outer subprocess (the
            // combined script itself); each inner per-component subprocess
            // it spawns in turn inherits that one process's environment
            // automatically, with no extra plumbing needed.
            foreach (var (name, value) in FillVerificationValues.Filter(component.Config.BrowserActions, component.VerificationValues))
                mergedVerificationValues[name] = value;
        }

        var combinedScriptFileName = FileNameSanitizer.SanitizeBaseName(config.ScriptFileName, "scraper");
        var combinedOutputFileBaseName = FileNameSanitizer.SanitizeBaseName(config.OutputFileName, "output");
        var combinedScript = PythonCombinedScriptGenerator.Generate(componentScripts, combinedScriptFileName, combinedOutputFileBaseName);

        // The verifier's own baseline timeout covers running every
        // component sequentially inside the combined script, not just one
        // script — extraTimeout only ever accounts for each component's own
        // ScrollStep cost the same way a single-mode request's own does; a
        // combined request with many slow components may need
        // VerifierTimeoutSeconds raised (see CompanionBackendOverrides).
        var combinedVerifier = registry.ResolveScriptVerifier("python");
        var combinedVerification = await combinedVerifier.VerifyAsync(
            combinedScript, OutputFormat.Json, combinedOutputFileBaseName, TimeSpan.FromMilliseconds(componentExtraTimeoutMs),
            mergedVerificationValues.Count > 0 ? mergedVerificationValues : null,
            config.IncludePreview == true, config.IncludeOutputFile == true);
        if (!combinedVerification.Success)
            return Results.UnprocessableEntity(new { error = combinedVerification.Error ?? "Script verification failed." });

        if (config.IncludePreview != true && config.IncludeOutputFile != true)
            return Results.Text(combinedScript, "text/plain");

        return Results.Json(new
        {
            script = combinedScript,
            preview = combinedVerification.Preview,
            outputFile = combinedVerification.OutputFileContent is not null
                ? new { fileName = combinedVerification.OutputFileName, content = combinedVerification.OutputFileContent }
                : null,
        });
    }

    // Issue #182: a list of independent extraction blocks, each with its own
    // Fields-or-Groups shape and its own output file, sharing this one
    // request's navigation/browser actions/proxy/persistent session/
    // pagination. Unlike Combined mode above, this is still exactly ONE
    // ScrapingPlan/ONE script/ONE verification subprocess — it goes through
    // the ordinary GenerateScript pipeline (ScrapingPlanBuilder already
    // knows how to build an ExtractionBlockStep, ScrapingPlanValidator
    // already knows how to validate one), just with per-block output
    // verification at the end instead of a single file.
    if (config.Blocks is { Count: > 0 } blocks)
    {
        if (config.Fields.Count > 0 || config.Groups is { Count: > 0 } || config.Api is not null || config.Combined is { Count: > 0 })
            return Results.BadRequest(new { error = "Blocks is mutually exclusive with Fields, Groups, Api and Combined." });
        // ChangeDetection/Hardening are per-block concerns for Blocks (each
        // block has its own independent result set to watch) — see
        // ScrapingConfig.Blocks. ExternalConfig's mapping onto more than one
        // block's own output isn't designed yet (see the same doc comment),
        // so it's rejected outright rather than guessed at.
        if (config.ChangeDetection is not null)
            return Results.BadRequest(new { error = "ChangeDetection is not supported on a Blocks request — set it on each block's own config instead." });
        if (config.Hardening is { Count: > 0 })
            return Results.BadRequest(new { error = "Hardening is not supported on a Blocks request — set it on each block's own config instead." });
        if (config.ExternalConfig == true)
            return Results.BadRequest(new { error = "ExternalConfig is not supported together with Blocks." });
        // Issue #191: same "not designed for more than one block's own
        // output yet" reasoning as ExternalConfig above — each block would
        // need its own mapping, not yet reachable from this UI.
        if (config.OutputBlueprint is not null)
            return Results.BadRequest(new { error = "OutputBlueprint is not supported together with Blocks." });

        for (var i = 0; i < blocks.Count; i++)
        {
            var hasBlockFields = blocks[i].Fields is { Count: > 0 };
            var hasBlockGroups = blocks[i].Groups is { Count: > 0 };
            if (hasBlockFields == hasBlockGroups)
                return Results.BadRequest(new { error = $"Block #{i + 1} needs exactly one of Fields or Groups." });
        }

        var (blockPlan, blockScript, blockValidationError, blockGeneratorError) = GenerateScript(config, registry);
        if (blockValidationError is not null)
            return Results.BadRequest(new { error = blockValidationError });
        if (blockGeneratorError is not null)
            return Results.UnprocessableEntity(new { error = blockGeneratorError });

        var blockExtractionStep = blockPlan!.Steps.OfType<ExtractionBlockStep>().Single();
        var blockOutputSpecs = blockExtractionStep.Blocks
            .Select(b => new BlockOutputSpec(b.Name, b.OutputFormat, b.OutputFileBaseName))
            .ToList();
        var blockExtraTimeout = TimeSpan.FromMilliseconds(
            blockPlan.Steps.OfType<ScrollStep>().Sum(step => (long)step.MaxIterations * step.WaitAfterMs));
        var blockVerificationEnv = FillVerificationValues.Filter(config.BrowserActions, config.VerificationValues);

        var blockVerifier = registry.ResolveScriptVerifier("python");
        var blockVerification = await blockVerifier.VerifyBlocksAsync(
            blockScript!, blockOutputSpecs, blockExtraTimeout,
            blockVerificationEnv.Count > 0 ? blockVerificationEnv : null,
            config.IncludePreview == true, config.IncludeOutputFile == true);
        if (!blockVerification.Success)
            return Results.UnprocessableEntity(new { error = blockVerification.Error ?? "Script verification failed." });

        if (config.IncludePreview != true && config.IncludeOutputFile != true)
            return Results.Text(blockScript!, "text/plain");

        return Results.Json(new
        {
            script = blockScript,
            blocks = blockVerification.Blocks!.Select(b => new
            {
                name = b.Name,
                preview = b.Preview,
                outputFile = b.OutputFileContent is not null
                    ? new { fileName = b.OutputFileName, content = b.OutputFileContent }
                    : null,
            }),
        });
    }

    var exclusivityError = ValidateModeExclusivity(config);
    if (exclusivityError is not null)
        return Results.BadRequest(new { error = exclusivityError });

    var (plan, script, validationError, generatorError) = GenerateScript(config, registry);
    if (validationError is not null)
        return Results.BadRequest(new { error = validationError });
    if (generatorError is not null)
        return Results.UnprocessableEntity(new { error = generatorError });

    // Actually run the generated script against the live page before handing
    // it out — this proves the exact artifact the user is about to download
    // works (network fetch, parsing, CSV export, no runtime errors) and
    // returns real data, rather than approximating that with a static
    // selector check that could disagree with what BeautifulSoup does.
    // A ScrollStep's own configured cost (MaxIterations × WaitAfterMs) can
    // exceed the verifier's baseline timeout on its own — added on top
    // rather than baked into the baseline, so scripts without a ScrollStep
    // keep the tight default instead of everyone paying for the slowest
    // possible configuration.
    var extraTimeout = TimeSpan.FromMilliseconds(
        plan!.Steps.OfType<ScrollStep>().Sum(step => (long)step.MaxIterations * step.WaitAfterMs));

    // One-time login/test values (Issue #43) for FillAction steps, matched
    // against BrowserActions.FillAction.EnvironmentVariableName and applied
    // only to this trial subprocess — never persisted, never reaches the
    // generator/generated script (see IR/FillVerificationValues.cs).
    var verificationEnv = FillVerificationValues.Filter(config.BrowserActions, config.VerificationValues);

    var verifier = registry.ResolveScriptVerifier("python");
    var verification = await verifier.VerifyAsync(
        script!, plan.OutputFormat, plan.OutputFileBaseName, extraTimeout,
        verificationEnv.Count > 0 ? verificationEnv : null, config.IncludePreview == true, config.IncludeOutputFile == true);
    if (!verification.Success)
    {
        return Results.UnprocessableEntity(new
        {
            error = verification.Error ?? "Script verification failed.",
        });
    }

    // Issue #122/#161: only a JSON envelope when the caller actually opted
    // into at least one of preview/full-output — every other caller (and
    // every existing test) keeps getting the exact same plain-text script
    // response as before either existed.
    if (config.IncludePreview != true && config.IncludeOutputFile != true)
        return Results.Text(script!, "text/plain");

    return Results.Json(new
    {
        script,
        preview = verification.Preview,
        outputFile = verification.OutputFileContent is not null
            ? new { fileName = verification.OutputFileName, content = verification.OutputFileContent }
            : null,
    });
});

app.Run();

public partial class Program { }

// Issue #141: POST /configs body — Config is bound as a raw JsonElement (not
// deserialized into ScrapingConfig) since the store treats it as an opaque
// blob, see SavedConfigStore's own doc comment.
public sealed class SaveConfigRequest
{
    public string? Url { get; set; }
    public string? Name { get; set; }
    public System.Text.Json.JsonElement Config { get; set; }
}

// Issue #202: POST /configs/{configId}/outputs body — Content is stored and
// returned verbatim, the same opaque-blob treatment ConfigJson above gets.
public sealed class SaveOutputRequest
{
    public string? Name { get; set; }
    public string? FileName { get; set; }
    public string? Content { get; set; }
}

// Issue #191: POST/PUT /blueprints body.
public sealed class SaveBlueprintRequest
{
    public string? Name { get; set; }
    public List<string>? FieldNames { get; set; }
}
