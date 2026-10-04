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
    // Issue #244: Output Blueprints' tree-shaped target schema (persisted,
    // site-independent — OutputBlueprintTreeSchemaGroup/...Field) and its
    // per-scrape mapping counterpart (OutputBlueprintTreeMappingGroup/
    // ...Field) each need the same polymorphic-list treatment.
    options.SerializerOptions.Converters.Add(new OutputBlueprintTreeSchemaNodeJsonConverter());
    options.SerializerOptions.Converters.Add(new OutputBlueprintTreeMappingNodeJsonConverter());
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

// Issue #279: same lazy-construction reasoning, its own SQLite file — see
// TransformPresetStore's own doc comment.
builder.Services.AddSingleton<TransformPresetStore>();

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

    // Issue #207: derive BlueprintId once, at save time, from this same
    // already-parsed Config — see SavedConfigStore.EnsureCreated's own doc
    // comment on why this is the one place ConfigJson's structure is looked
    // at at all. Absent/malformed outputBlueprint or blueprintId simply
    // yields null, same as "no Blueprint set".
    long? blueprintId = request.Config.TryGetProperty("outputBlueprint", out var blueprintProp) &&
        blueprintProp.ValueKind == System.Text.Json.JsonValueKind.Object &&
        blueprintProp.TryGetProperty("blueprintId", out var blueprintIdProp) &&
        blueprintIdProp.ValueKind == System.Text.Json.JsonValueKind.Number
        ? blueprintIdProp.GetInt64()
        : null;

    var saved = store.Save(url, name, request.Config.GetRawText(), blueprintId);
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
        record.BlueprintId,
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
// the user's machine. Replaying hardening checks against a saved output
// (once its own separate issue, #207) is its own endpoint further down —
// see /configs/{configId}/outputs/{id}/replay-hardening below.
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

// Issue #207: replays hardening checks against this already-saved output —
// a popup-driven, on-demand analysis/tuning aid, resolved above by this same
// comment on /configs/{configId}/outputs' own doc comment. Never touches the
// generated .py script or any of its templates; HardeningReplayEvaluator is
// the one source of truth for the actual per-check logic, mirrored from
// (not reimplemented independently of) the Python templates' own runtime
// helpers. checks is exactly ScrapingConfig.Hardening's own wire shape — the
// extension sends whatever's currently configured live in its own popup
// (via buildHardeningConfig), not necessarily what was saved with this
// output originally, per the issue's own "what would today's checks report"
// framing.
app.MapPost("/configs/{configId:long}/outputs/{id:long}/replay-hardening",
    (long configId, long id, ReplayHardeningRequest? request, SavedConfigStore store) =>
{
    var output = store.GetOutput(id);
    if (output is null || output.SavedConfigId != configId)
        return Results.NotFound(new { error = "Saved output not found." });

    if (request?.Checks is not { Count: > 0 })
        return Results.BadRequest(new { error = "At least one hardening check is required." });

    // Only resolved when a BaselineCheck is actually present — every other
    // check kind needs nothing beyond the one output being evaluated.
    int? previousResultCount = null;
    string? previousUnavailableReason = null;
    if (request.Checks.Any(check => check is BaselineCheck))
    {
        SavedOutputSummary? previous;
        if (request.CompareBasis == "blueprint")
        {
            var config = store.Get(configId);
            if (config?.BlueprintId is { } blueprintId)
            {
                previous = store.GetMostRecentOutputForBlueprint(blueprintId, excludeOutputId: id);
            }
            else
            {
                previous = null;
                previousUnavailableReason = "This configuration has no Output Blueprint set — pick \"same configuration\" instead, or set a Blueprint first.";
            }
        }
        else
        {
            previous = store.GetMostRecentOutputForConfig(configId, excludeOutputId: id);
        }

        if (previous is not null)
        {
            var previousRecord = store.GetOutput(previous.Id)!;
            previousResultCount = HardeningReplayEvaluator.GetResultCount(previousRecord.FileName, previousRecord.Content);
        }
        else
        {
            previousUnavailableReason ??= "No earlier saved output is available to compare against.";
        }
    }

    var results = HardeningReplayEvaluator.Evaluate(
        request.Checks, output.FileName, output.Content, previousResultCount, previousUnavailableReason);
    return Results.Ok(new { results });
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

// Issue #244: shared POST/PUT validation, now branching on SchemaKind — a
// missing/blank value defaults to "Flat" (byte-for-byte today's only schema
// kind, so an older extension build's request without this field at all
// keeps working unchanged). PascalCase ("Flat"/"Tree", matched case-
// insensitively on input) matches the same convention every other wire
// enum in this codebase already serializes as via the global
// JsonStringEnumConverter (OutputFormat, HardeningCheck.Severity, ...) —
// including OutputBlueprintMapping.SchemaKind itself, the /generate-time
// counterpart of this /blueprints-time value — so the extension never needs
// to translate between two different casings for the "same" concept. A
// "Tree" request's own structural checks are delegated to
// OutputBlueprintTreeSchemaValidator (the same validator ScrapingPlanValidator
// itself has no reason to duplicate); its FieldNames is ignored either way,
// mirroring how a "Flat" request's Tree is ignored.
static (string? Name, string SchemaKind, List<string>? FieldNames, List<OutputBlueprintTreeSchemaNode>? Tree, string? Error)
    ValidateBlueprintRequest(SaveBlueprintRequest? request)
{
    var name = request?.Name?.Trim();
    if (string.IsNullOrWhiteSpace(name))
        return (null, "", null, null, "Name is required.");

    var requestedKind = request?.SchemaKind?.Trim();
    var schemaKind = string.IsNullOrWhiteSpace(requestedKind) ? "Flat"
        : string.Equals(requestedKind, "Flat", StringComparison.OrdinalIgnoreCase) ? "Flat"
        : string.Equals(requestedKind, "Tree", StringComparison.OrdinalIgnoreCase) ? "Tree"
        : null;
    if (schemaKind is null)
        return (null, "", null, null, "SchemaKind must be 'Flat' or 'Tree'.");

    if (schemaKind == "Tree")
    {
        var treeError = OutputBlueprintTreeSchemaValidator.Validate(request?.Tree ?? []);
        return treeError is not null
            ? (null, "", null, null, treeError)
            : (name, schemaKind, null, request!.Tree, null);
    }

    var fieldNames = NormalizeBlueprintFieldNames(request?.FieldNames);
    if (fieldNames is not { Count: > 0 })
        return (null, "", null, null, "At least one field name is required.");
    if (fieldNames.Distinct().Count() != fieldNames.Count)
        return (null, "", null, null, "Field names must be unique.");

    return (name, schemaKind, fieldNames, null, null);
}

app.MapPost("/blueprints", (SaveBlueprintRequest? request, OutputBlueprintStore store) =>
{
    var (name, schemaKind, fieldNames, tree, error) = ValidateBlueprintRequest(request);
    if (error is not null)
        return Results.BadRequest(new { error });

    var saved = store.Save(name!, schemaKind, fieldNames, tree);
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

    var (name, schemaKind, fieldNames, tree, error) = ValidateBlueprintRequest(request);
    if (error is not null)
        return Results.BadRequest(new { error });

    store.Update(id, name!, schemaKind, fieldNames, tree);
    return Results.Ok(new { id, name, schemaKind, fieldNames, tree });
});

app.MapDelete("/blueprints/{id:long}", (long id, OutputBlueprintStore store) =>
    store.Delete(id) ? Results.NoContent() : Results.NotFound(new { error = "Output blueprint not found." }));

// Issue #279: reusable, named transform-chain presets — see
// TransformPresetStore. A preset is validated with the exact same rules a
// field's own chain gets at /generate time (ScrapingPlanValidator, via a
// throwaway one-field plan, so FieldTransformValidator's regex/format/onError
// checks apply unchanged), plus two preset-specific ones: at least one step,
// and no combineFields/splitField — those reference *other* fields by name,
// which only means something inside one specific field list, never as a
// reusable chain applied to arbitrary fields.
static string? ValidateTransformPresetChain(List<FieldTransform>? transforms)
{
    if (transforms is not { Count: > 0 })
        return "A preset needs at least one transform step.";
    if (transforms.Any(t => t is null))
        return "A preset contains an invalid transform step.";
    if (transforms.Any(t => t is CombineFieldsTransform or SplitFieldTransform))
        return "Combine/split steps reference other fields by name and can't be part of a reusable preset.";

    var plan = new ScrapingPlan
    {
        Steps =
        [
            new NavigateStep { Urls = ["https://example.com"] },
            new ExtractStep { Name = "preset", Selector = "*", Transforms = transforms },
        ],
    };
    var result = ScrapingPlanValidator.Validate(plan);
    return result.Success ? null : result.Error;
}

app.MapPost("/transform-presets", (SaveTransformPresetRequest? request, TransformPresetStore store) =>
{
    var name = request?.Name?.Trim();
    if (string.IsNullOrWhiteSpace(name))
        return Results.BadRequest(new { error = "Name is required." });
    var chainError = ValidateTransformPresetChain(request!.Transforms);
    if (chainError is not null)
        return Results.BadRequest(new { error = chainError });
    if (store.NameTaken(name))
        return Results.Conflict(new { error = $"A preset named '{name}' already exists." });

    var saved = store.Save(name, request.Transforms!);
    return Results.Created($"/transform-presets/{saved.Id}", saved);
});

app.MapGet("/transform-presets", (TransformPresetStore store) => Results.Ok(store.ListAll()));

app.MapPut("/transform-presets/{id:long}", (long id, RenameTransformPresetRequest? request, TransformPresetStore store) =>
{
    if (!store.Exists(id))
        return Results.NotFound(new { error = "Transform preset not found." });
    var name = request?.Name?.Trim();
    if (string.IsNullOrWhiteSpace(name))
        return Results.BadRequest(new { error = "Name is required." });
    if (store.NameTaken(name, id))
        return Results.Conflict(new { error = $"A preset named '{name}' already exists." });

    store.Rename(id, name);
    return Results.Ok(new { id, name });
});

app.MapDelete("/transform-presets/{id:long}", (long id, TransformPresetStore store) =>
    store.Delete(id) ? Results.NoContent() : Results.NotFound(new { error = "Transform preset not found." }));

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

    // Issue #174: same reasoning as AdditionalUrls above — Api-Mode never
    // reads the page-scraping start URL, so pagination would silently do
    // nothing there.
    if (hasApi && config.Pagination is not null)
        return "Pagination and Api are mutually exclusive.";

    // Issue #218: same reasoning as AdditionalUrls/Pagination above.
    if (hasApi && config.DiscoveredUrls is not null)
        return "DiscoveredUrls and Api are mutually exclusive.";

    // Issue #219: Api has no single fixed start URL to preflight-check —
    // same reasoning as AdditionalUrls/Pagination/DiscoveredUrls above.
    if (hasApi && config.Preflight == true)
        return "Preflight and Api are mutually exclusive.";

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

// Issue #289 follow-up: a ScrollStep/WaitForStep's own configured cost can
// make the verifier's trial run legitimately take a long time — summed
// across every such step in the plan AND every BrowserDiscoverySource
// parameter's own nested Actions (Issue #216), since those run as their own
// separate, sequential Playwright sessions during parameter resolution,
// before the main request loop even starts, and never go through
// ScrapingPlanBuilder's own step translation (see BrowserDiscoverySource's
// own doc comment) — invisible to a plain plan.Steps.OfType<ScrollStep>()
// scan on its own, which is exactly the gap that let a long-running
// discovery configuration always fail verification with a generic timeout.
static long EstimateExtraVerificationTimeoutMs(ScrapingPlan plan)
{
    var ms = plan.Steps.OfType<ScrollStep>().Sum(step => (long)step.MaxIterations * step.WaitAfterMs)
        + plan.Steps.OfType<WaitForStep>().Sum(step => (long)step.TimeoutMs);

    var apiCallStep = plan.Steps.OfType<ApiCallStep>().SingleOrDefault();
    if (apiCallStep is not null)
    {
        foreach (var parameter in apiCallStep.Config.Parameters)
        {
            if (parameter.Source is not BrowserDiscoverySource { Actions: { } actions })
                continue;
            ms += actions.OfType<ScrollAction>().Sum(action => (long)action.MaxIterations * action.WaitAfterMs)
                + actions.OfType<WaitForAction>().Sum(action => (long)action.TimeoutMs);
        }
    }

    return ms;
}

// A trial run exists to prove the artifact works, not to accommodate an
// unboundedly slow configuration — once EstimateExtraVerificationTimeoutMs
// alone exceeds this, the real run is skipped entirely (the script is still
// generated and returned, just without having been run against the live
// page first — see VerificationSkippedHeader) rather than letting one
// /generate call tie up the companion for an arbitrary amount of time. A
// local function (top-level statements can't declare a plain static
// readonly field) rather than a CompanionBackendOverrides knob like
// VerifierTimeoutSeconds — this is a safety cap on the *estimate*, not a
// tuning parameter for a slower machine.
static TimeSpan VerificationTimeoutCap() => TimeSpan.FromMinutes(10);

// Present on the /generate response (regardless of whether the body ends up
// plain-text or the JSON preview/outputFile envelope — a header survives
// either shape unchanged) whenever the trial run was skipped for exceeding
// VerificationTimeoutCap. Value is a plain English reason, same "companion
// error text is always English, never part of the extension's i18n system"
// convention CLAUDE.md already documents for /generate's 400/422 bodies.
const string VerificationSkippedHeader = "X-ScrapingFactory-Verification-Skipped";

static string? CheckVerificationTimeoutCap(long extraTimeoutMs)
{
    var extra = TimeSpan.FromMilliseconds(extraTimeoutMs);
    var cap = VerificationTimeoutCap();
    if (extra <= cap)
        return null;
    return $"Estimated extra verification time ({extra:hh\\:mm\\:ss}) exceeds the {cap:hh\\:mm\\:ss} cap for a " +
           "/generate trial run — the generated script was returned without being run against the live page first. Test it " +
           "manually before relying on it.";
}

app.MapPost("/generate", async ([FromBody] ScrapingConfig? config, LanguageModuleRegistry registry, HttpContext httpContext) =>
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
        if (config.DiscoveredUrls is not null)
            return Results.BadRequest(new { error = "DiscoveredUrls is not supported on a Combined request — set it on each component's own config instead." });
        if (config.Preflight == true)
            return Results.BadRequest(new { error = "Preflight is not supported on a Combined request — set it on each component's own config instead." });
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
            componentExtraTimeoutMs += EstimateExtraVerificationTimeoutMs(componentPlan!);

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
        // script — extraTimeoutMs sums each component's own estimate the
        // same way a single-mode request's own does; a combined request
        // with many slow components may need VerifierTimeoutSeconds raised
        // (see CompanionBackendOverrides) on top of that, for the baseline
        // itself.
        ScriptVerificationResult combinedVerification;
        var combinedSkipReason = CheckVerificationTimeoutCap(componentExtraTimeoutMs);
        if (combinedSkipReason is not null)
        {
            httpContext.Response.Headers[VerificationSkippedHeader] = combinedSkipReason;
            combinedVerification = new ScriptVerificationResult { Success = true };
        }
        else
        {
            var combinedVerifier = registry.ResolveScriptVerifier("python");
            combinedVerification = await combinedVerifier.VerifyAsync(
                combinedScript, OutputFormat.Json, combinedOutputFileBaseName, TimeSpan.FromMilliseconds(componentExtraTimeoutMs),
                mergedVerificationValues.Count > 0 ? mergedVerificationValues : null,
                config.IncludePreview == true, config.IncludeOutputFile == true);
            if (!combinedVerification.Success)
                return Results.UnprocessableEntity(new { error = combinedVerification.Error ?? "Script verification failed." });
        }

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
        // Issue #218: not designed for Blocks' multi-output shape yet — same
        // "reject outright rather than guess" precedent as ExternalConfig/
        // OutputBlueprint above.
        if (config.DiscoveredUrls is not null)
            return Results.BadRequest(new { error = "DiscoveredUrls is not supported together with Blocks." });
        // Issue #219: not designed for Blocks' multi-output shape yet — same
        // "reject outright rather than guess" precedent as DiscoveredUrls/
        // ExternalConfig/OutputBlueprint above.
        if (config.Preflight == true)
            return Results.BadRequest(new { error = "Preflight is not supported together with Blocks." });

        for (var i = 0; i < blocks.Count; i++)
        {
            var hasBlockFields = blocks[i].Fields is { Count: > 0 };
            var hasBlockGroups = blocks[i].Groups is { Count: > 0 };
            if (hasBlockFields == hasBlockGroups)
                return Results.BadRequest(new { error = $"Block #{i + 1} needs exactly one of Fields or Groups." });
            // Issue #214: Download isn't wired into Blocks-mode's own flat
            // field serialization yet (see ScrapingPlanBuilder's Blocks
            // branch, which deliberately doesn't carry it onto ExtractStep)
            // — same "not designed for this yet, reject rather than
            // silently no-op" precedent as ExternalConfig/OutputBlueprint
            // above.
            if (blocks[i].Fields?.Any(f => f.Download) == true)
                return Results.BadRequest(new { error = $"Block #{i + 1}: Download is not supported on a block's own fields yet." });
            // Issue #206 follow-up: the dedicated combineFields/splitField
            // creation flow (and HiddenFromOutput) is deliberately not
            // exposed for Blocks mode — it happens to reuse flat mode's own
            // field modal, but neither scraper_blocks.py.j2 nor
            // playwright_scraper_blocks.py.j2 were updated to handle a
            // blank Selector or a hidden field, same "reject rather than
            // silently no-op" precedent as Download above.
            if (blocks[i].Fields?.Any(f => string.IsNullOrWhiteSpace(f.Selector) || f.HiddenFromOutput) == true)
                return Results.BadRequest(new { error = $"Block #{i + 1}: combineFields/splitField-derived fields and HiddenFromOutput are not supported on a block's own fields yet." });
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
        var blockExtraTimeoutMs = EstimateExtraVerificationTimeoutMs(blockPlan);
        var blockVerificationEnv = FillVerificationValues.Filter(config.BrowserActions, config.VerificationValues);

        ScriptVerificationResult blockVerification;
        var blockSkipReason = CheckVerificationTimeoutCap(blockExtraTimeoutMs);
        if (blockSkipReason is not null)
        {
            httpContext.Response.Headers[VerificationSkippedHeader] = blockSkipReason;
            blockVerification = new ScriptVerificationResult
            {
                Success = true,
                Blocks = blockOutputSpecs.Select(spec => new BlockVerificationResult { Name = spec.Name }).ToList(),
            };
        }
        else
        {
            var blockVerifier = registry.ResolveScriptVerifier("python");
            blockVerification = await blockVerifier.VerifyBlocksAsync(
                blockScript!, blockOutputSpecs, TimeSpan.FromMilliseconds(blockExtraTimeoutMs),
                blockVerificationEnv.Count > 0 ? blockVerificationEnv : null,
                config.IncludePreview == true, config.IncludeOutputFile == true);
            if (!blockVerification.Success)
                return Results.UnprocessableEntity(new { error = blockVerification.Error ?? "Script verification failed." });
        }

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

    var (planOrNull, script, validationError, generatorError) = GenerateScript(config, registry);
    if (validationError is not null)
        return Results.BadRequest(new { error = validationError });
    if (generatorError is not null)
        return Results.UnprocessableEntity(new { error = generatorError });
    // GenerateScript's own invariant: Plan is non-null exactly when both
    // ValidationError and GeneratorError are null, i.e. right here — but the
    // compiler can't see across that tuple, so this makes it explicit once
    // instead of needing a `!` at every later plan.* access.
    var plan = planOrNull!;

    // Actually run the generated script against the live page before handing
    // it out — this proves the exact artifact the user is about to download
    // works (network fetch, parsing, CSV export, no runtime errors) and
    // returns real data, rather than approximating that with a static
    // selector check that could disagree with what BeautifulSoup does.
    // A ScrollStep/WaitForStep's own configured cost (and, for Api-mode, any
    // BrowserDiscoverySource parameter's own nested Actions — Issue #216)
    // can exceed the verifier's baseline timeout on its own — added on top
    // rather than baked into the baseline, so scripts without any of these
    // keep the tight default instead of everyone paying for the slowest
    // possible configuration. See VerificationTimeoutCap below for what
    // happens once the estimate itself gets unreasonably large.
    var extraTimeoutMs = EstimateExtraVerificationTimeoutMs(plan);

    // One-time login/test values (Issue #43) for FillAction steps, matched
    // against BrowserActions.FillAction.EnvironmentVariableName and applied
    // only to this trial subprocess — never persisted, never reaches the
    // generator/generated script (see IR/FillVerificationValues.cs). Also
    // covers Api mode's bootstrap credentials (Issue #220).
    var verificationEnv = FillVerificationValues.Filter(config.BrowserActions, config.VerificationValues, config.Api);

    ScriptVerificationResult verification;
    var skipReason = CheckVerificationTimeoutCap(extraTimeoutMs);
    if (skipReason is not null)
    {
        httpContext.Response.Headers[VerificationSkippedHeader] = skipReason;
        verification = new ScriptVerificationResult { Success = true };
    }
    else
    {
        var verifier = registry.ResolveScriptVerifier("python");
        verification = await verifier.VerifyAsync(
            script!, plan.OutputFormat, plan.OutputFileBaseName, TimeSpan.FromMilliseconds(extraTimeoutMs),
            verificationEnv.Count > 0 ? verificationEnv : null, config.IncludePreview == true, config.IncludeOutputFile == true);
        if (!verification.Success)
        {
            return Results.UnprocessableEntity(new
            {
                error = verification.Error ?? "Script verification failed.",
            });
        }
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

// Issue #207: POST /configs/{configId}/outputs/{id}/replay-hardening body —
// Checks reuses ScrapingConfig.Hardening's own polymorphic wire shape
// verbatim (the extension sends buildHardeningConfig's own output, exactly
// as a real /generate request would). CompareBasis is only meaningful
// when Checks includes a BaselineCheck — "config" (default when
// null/anything else) or "blueprint".
public sealed class ReplayHardeningRequest
{
    public List<HardeningCheck>? Checks { get; set; }
    public string? CompareBasis { get; set; }
}

// Issue #279: POST /transform-presets body.
public sealed class SaveTransformPresetRequest
{
    public string? Name { get; set; }
    public List<FieldTransform>? Transforms { get; set; }
}

// Issue #279: PUT /transform-presets/{id} body (rename only).
public sealed class RenameTransformPresetRequest
{
    public string? Name { get; set; }
}

// Issue #191: POST/PUT /blueprints body.
public sealed class SaveBlueprintRequest
{
    public string? Name { get; set; }
    public List<string>? FieldNames { get; set; }

    // Issue #244: "Flat" (default when absent/blank, for backward
    // compatibility with a pre-#244 extension build) or "Tree" — see
    // ValidateBlueprintRequest.
    public string? SchemaKind { get; set; }
    public List<OutputBlueprintTreeSchemaNode>? Tree { get; set; }
}
