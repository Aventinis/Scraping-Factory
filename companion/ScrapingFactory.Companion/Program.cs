using Microsoft.AspNetCore.Mvc;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.UseUrls("http://localhost:5000");

builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy => policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

app.UseCors();

app.MapGet("/health", () => Results.Ok());

app.MapPost("/generate", ([FromBody] ScrapingConfig? config) =>
{
    if (config is null || string.IsNullOrWhiteSpace(config.Url) || config.Fields.Count == 0)
        return Results.BadRequest(new { error = "Invalid ScrapingConfig: Url and at least one Field are required." });

    var generator = new PythonCodeGenerator();
    var script = generator.Generate(config);
    return Results.Text(script, "text/plain");
});

app.Run();

public partial class Program { }
