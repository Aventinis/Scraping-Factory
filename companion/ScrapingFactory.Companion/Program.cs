using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.UseUrls("http://localhost:5000");

builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy => policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

var app = builder.Build();

app.UseCors();

app.MapGet("/health", () => Results.Ok());

app.MapPost("/generate", async ([FromBody] ScrapingConfig? config) =>
{
    if (config is null || string.IsNullOrWhiteSpace(config.Url) || config.Fields.Count == 0)
        return Results.BadRequest(new { error = "Invalid ScrapingConfig: Url and at least one Field are required." });

    var generator = new PythonCodeGenerator();
    var script = generator.Generate(config);

    // Actually run the generated script against the live page before handing
    // it out — this proves the exact artifact the user is about to download
    // works (network fetch, parsing, CSV export, no runtime errors) and
    // returns real data, rather than approximating that with a static
    // selector check that could disagree with what BeautifulSoup does.
    var verifier = new PythonScriptVerifier();
    var verification = await verifier.VerifyAsync(script);
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
