using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.IR;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.UseUrls("http://localhost:5000");

builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy => policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
    // Required for Container-Mode: List<ContainerNode> mixes GroupNode and
    // DataFieldNode, which System.Text.Json can't (de)serialize through the
    // abstract base type on its own — see ContainerNodeJsonConverter.
    options.SerializerOptions.Converters.Add(new ContainerNodeJsonConverter());
});

builder.Services.AddSingleton<LanguageModuleRegistry>();

var app = builder.Build();

app.UseCors();

app.MapGet("/health", () => Results.Ok());

app.MapPost("/generate", async ([FromBody] ScrapingConfig? config, LanguageModuleRegistry registry) =>
{
    var hasFields = config?.Fields.Count > 0;
    var hasGroups = config?.Groups?.Count > 0;
    if (config is null || string.IsNullOrWhiteSpace(config.Url) || (!hasFields && !hasGroups))
    {
        return Results.BadRequest(new
        {
            error = "Invalid ScrapingConfig: Url and at least one Field or Group are required.",
        });
    }

    // Flat-Mode (Fields → Csv) and Container-Mode (Groups → Xml) are
    // strictly separate — mixing them in one request would leave it
    // ambiguous which extraction phase (and OutputFormat) the caller wants.
    if (hasFields && hasGroups)
        return Results.BadRequest(new { error = "Fields und Groups schließen sich aus." });

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
    // engine (Static requests+BeautifulSoup vs. Browser Playwright) comes
    // straight from the request.
    var generator = registry.ResolveCodeGenerator("python", plan.Engine);
    var script = generator.Generate(plan);

    // Actually run the generated script against the live page before handing
    // it out — this proves the exact artifact the user is about to download
    // works (network fetch, parsing, CSV export, no runtime errors) and
    // returns real data, rather than approximating that with a static
    // selector check that could disagree with what BeautifulSoup does.
    var verifier = registry.ResolveScriptVerifier("python");
    var verification = await verifier.VerifyAsync(script, plan.OutputFormat);
    if (!verification.Success)
    {
        return Results.UnprocessableEntity(new
        {
            error = verification.Error ?? "Skript-Verifikation fehlgeschlagen.",
        });
    }

    return Results.Text(script, "text/plain");
});

app.Run();

public partial class Program { }
