using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using ScrapingFactory.Companion;
using ScrapingFactory.Compiler.Backends;
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

app.MapGet("/configs", (string? url, SavedConfigStore store) =>
{
    if (string.IsNullOrWhiteSpace(url))
        return Results.BadRequest(new { error = "The url query parameter is required." });

    return Results.Ok(store.ListByUrl(url));
});

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

app.MapPost("/generate", async ([FromBody] ScrapingConfig? config, LanguageModuleRegistry registry) =>
{
    var hasFields = config?.Fields.Count > 0;
    var hasGroups = config?.Groups?.Count > 0;
    var hasApi = config?.Api is not null;
    if (config is null || string.IsNullOrWhiteSpace(config.Url) || (!hasFields && !hasGroups && !hasApi))
    {
        return Results.BadRequest(new
        {
            error = "Invalid ScrapingConfig: Url and at least one Field, Group or Api are required.",
        });
    }

    // Flat-Mode (Fields → Csv), Container-Mode (Groups → Xml) and API-Mode
    // (Api → Csv) are strictly separate — mixing any two in one request
    // would leave it ambiguous which extraction phase (and OutputFormat)
    // the caller wants.
    if (hasFields && hasGroups)
        return Results.BadRequest(new { error = "Fields and Groups are mutually exclusive." });
    if (hasFields && hasApi)
        return Results.BadRequest(new { error = "Fields and Api are mutually exclusive." });
    if (hasGroups && hasApi)
        return Results.BadRequest(new { error = "Groups and Api are mutually exclusive." });

    // Issue #83: Api-Mode builds its own request URL from UrlTemplate/
    // Parameters and never reads the page-scraping start URL at all — an
    // AdditionalUrls list here would silently do nothing, so it's rejected
    // outright instead, same as the other three mode combinations above.
    if (hasApi && config.AdditionalUrls is { Count: > 0 })
        return Results.BadRequest(new { error = "AdditionalUrls and Api are mutually exclusive." });

    // Issue #174: same reasoning as AdditionalUrls above — Api-Mode never
    // reads the page-scraping start URL, so pagination would silently do
    // nothing there.
    if (hasApi && config.Pagination is not null)
        return Results.BadRequest(new { error = "Pagination and Api are mutually exclusive." });

    // Wire format (Fields/Groups) is unchanged; internally it's compiled
    // into the canonical Steps-based ScrapingPlan that backends actually
    // consume.
    var plan = ScrapingPlanBuilder.Build(config);

    // Fast structural checks (malformed URL, duplicate/empty field names)
    // before paying for codegen and a real subprocess/network round trip.
    // Deliberately doesn't validate CSS selector syntax — that's still only
    // proven by actually running the script below.
    var planValidation = ScrapingPlanValidator.Validate(plan);
    if (!planValidation.Success)
        return Results.BadRequest(new { error = planValidation.Error });

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
        return Results.UnprocessableEntity(new { error = ex.Message });
    }
    var script = generator.Generate(plan);

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
        plan.Steps.OfType<ScrollStep>().Sum(step => (long)step.MaxIterations * step.WaitAfterMs));

    // One-time login/test values (Issue #43) for FillAction steps, matched
    // against BrowserActions.FillAction.EnvironmentVariableName and applied
    // only to this trial subprocess — never persisted, never reaches the
    // generator/generated script (see IR/FillVerificationValues.cs).
    var verificationEnv = FillVerificationValues.Filter(config.BrowserActions, config.VerificationValues);

    var verifier = registry.ResolveScriptVerifier("python");
    var verification = await verifier.VerifyAsync(
        script, plan.OutputFormat, plan.OutputFileBaseName, extraTimeout,
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
        return Results.Text(script, "text/plain");

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
