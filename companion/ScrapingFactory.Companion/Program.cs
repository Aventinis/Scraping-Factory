using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using ScrapingFactory.Companion.Verification;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.UseUrls("http://localhost:5000");

builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy => policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

// Same 10s timeout the generated script itself uses (requests.get(url, timeout=10))
// so verification and the delivered script behave consistently.
builder.Services.AddHttpClient<ScrapingVerifier>(client => client.Timeout = TimeSpan.FromSeconds(10));

var app = builder.Build();

app.UseCors();

app.MapGet("/health", () => Results.Ok());

app.MapPost("/generate", async ([FromBody] ScrapingConfig? config, ScrapingVerifier verifier) =>
{
    if (config is null || string.IsNullOrWhiteSpace(config.Url) || config.Fields.Count == 0)
        return Results.BadRequest(new { error = "Invalid ScrapingConfig: Url and at least one Field are required." });

    // Verify against the live page before handing out a script for it — a
    // script whose selectors don't match anything is useless, and finding
    // that out now (with actionable per-field detail) beats the user
    // discovering it after downloading and running the script.
    var verification = await verifier.VerifyAsync(config);
    if (!verification.Success)
    {
        return Results.UnprocessableEntity(new
        {
            error = verification.Error
                ?? "Mindestens ein Selektor hat kein Element auf der Seite gefunden.",
            fields = verification.Fields.Select(f => new { f.Name, f.Selector, f.MatchCount, f.Success }),
        });
    }

    var generator = new PythonCodeGenerator();
    var script = generator.Generate(config);
    return Results.Text(script, "text/plain");
});

app.Run();

public partial class Program { }
