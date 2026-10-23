using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using ScrapingFactory.Companion;
using ScrapingFactory.Companion.Auth;
using ScrapingFactory.Companion.Endpoints;
using ScrapingFactory.Companion.Storage;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;

var builder = WebApplication.CreateBuilder(args);

// Optional per-user settings file (written by the installer).
CompanionUserSettings.Apply(builder.Configuration, args);

// `user add|list|...`: user administration on the machine running the companion, without starting the web host.
if (UserCommands.IsUserCommand(args))
{
    Environment.ExitCode = UserCommands.Run(args, builder.Configuration);
    return;
}

// Refuse configurations that would send passwords or keys in clear text beyond this machine; set up HTTPS when configured.
var transportError = CompanionTls.Validate(builder.Configuration) ?? AuthOptions.Validate(builder.Configuration)
    ?? EmailOptions.Validate(builder.Configuration);
if (transportError is not null)
{
    Console.Error.WriteLine($"ERROR: {transportError}");
    Environment.ExitCode = 1;
    return;
}

builder.WebHost.UseUrls(CompanionHostOptions.BuildListenUrl(builder.Configuration));
if (CompanionTls.IsEnabled(builder.Configuration))
{
    var certificate = CompanionTls.LoadCertificate(builder.Configuration, out var certificateDescription);
    builder.WebHost.ConfigureKestrel(kestrel => kestrel.ConfigureHttpsDefaults(https => https.ServerCertificate = certificate));
    Console.WriteLine($"HTTPS enabled with {certificateDescription}.");
}

builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy => policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
    // The polymorphic node lists (container, API, request body, blueprint schema/mapping) need their structural converters.
    options.SerializerOptions.Converters.Add(new ContainerNodeJsonConverter());
    options.SerializerOptions.Converters.Add(new ApiNodeJsonConverter());
    options.SerializerOptions.Converters.Add(new ApiBodyNodeJsonConverter());
    options.SerializerOptions.Converters.Add(new OutputBlueprintTreeSchemaNodeJsonConverter());
    options.SerializerOptions.Converters.Add(new OutputBlueprintTreeMappingNodeJsonConverter());
});

builder.Services.AddSingleton(new LanguageModuleRegistry(CompanionBackendOverrides.Build(builder.Configuration)));

// The stores are created lazily, on the first request that needs one, so /health and /generate never touch storage. Which
// implementation backs them (SQLite or MySQL) comes from Companion:Storage:* (StorageOptions).
builder.Services.AddSingleton<ISavedConfigStore>(sp => StorageOptions.CreateSavedConfigStore(sp.GetRequiredService<IConfiguration>()));

builder.Services.AddSingleton<IOutputBlueprintStore>(sp => StorageOptions.CreateOutputBlueprintStore(sp.GetRequiredService<IConfiguration>()));

builder.Services.AddSingleton<ITransformPresetStore>(sp => StorageOptions.CreateTransformPresetStore(sp.GetRequiredService<IConfiguration>()));

// The users behind the access keys, in the same backend as the data.
builder.Services.AddSingleton<IUserStore>(sp => StorageOptions.CreateUserStore(sp.GetRequiredService<IConfiguration>()));

// Abuse protection for /auth/login and /auth/register.
builder.Services.AddSingleton<LoginThrottle>();

// Email: the sender (SMTP when configured), the throttle for mail-sending endpoints and the code service.
builder.Services.AddSingleton<IEmailSender>(sp =>
    EmailOptions.ReadSmtp(sp.GetRequiredService<IConfiguration>()) is { } smtp ? new SmtpEmailSender(smtp) : new NoEmailSender());
builder.Services.AddSingleton<EmailThrottle>();
builder.Services.AddSingleton<EmailService>();

var app = builder.Build();

// Fail fast on an unknown storage provider or a missing MySQL connection string (no connection is opened).
StorageOptions.Validate(app.Configuration);

app.UseCors();

// An unreachable MySQL database only shows up when a store is first used: answer 503 with the driver's message, not an anonymous 500.
app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (MySqlConnector.MySqlException exception) when (!context.Response.HasStarted)
    {
        context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
        await context.Response.WriteAsJsonAsync(new { error = $"The storage database is not available: {exception.Message}" });
    }
});

// Optional authentication (off by default). When on, every request except /health and CORS preflights needs
// `Authorization: Bearer <access key>`; the key resolves to the user whose data every store call is scoped to. Without it
// everything runs as the anonymous owner 0.
var authEnabled = AuthOptions.IsEnabled(app.Configuration);
var registrationOpen = AuthOptions.IsRegistrationOpen(app.Configuration);
var emailPolicy = EmailOptions.Read(app.Configuration);
app.Use(async (context, next) =>
{
    // /health and the endpoints a person without a key has to reach (register, login, password reset).
    var anonymous = context.Request.Path == "/health"
        || context.Request.Path == "/auth/register" || context.Request.Path == "/auth/login"
        || context.Request.Path == "/auth/forgot-password" || context.Request.Path == "/auth/reset-password";
    if (!authEnabled || HttpMethods.IsOptions(context.Request.Method) || anonymous)
    {
        CurrentUser.Set(context, CurrentUser.Anonymous);
        await next();
        return;
    }

    var key = AuthEndpoints.BearerToken(context);
    var user = key.Length > 0 ? context.RequestServices.GetRequiredService<IUserStore>().FindByKey(key) : null;
    if (user is null)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        context.Response.Headers.WWWAuthenticate = "Bearer";
        await context.Response.WriteAsJsonAsync(new { error = key.Length == 0
            ? "This companion requires an access key — enter it in the extension's Settings."
            : "The access key is not valid." });
        return;
    }
    CurrentUser.Set(context, new CurrentUser(user.Id, user.Name));

    // With RequireVerified, an account without a confirmed email can sign in and use the account endpoints to confirm one, but
    // not the data (403 with a code the extension recognizes; the key itself is fine).
    if (emailPolicy.RequireVerified && !user.EmailVerified
        && !(context.Request.Path == "/whoami" || context.Request.Path.StartsWithSegments("/auth")))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new
        {
            error = user.Email is null
                ? "This companion requires a verified email address - add one in the extension's Settings > Account."
                : "This companion requires a verified email address - enter the code from the email in the extension's Settings > Account.",
            code = "email_unverified",
        });
        return;
    }
    await next();
});

// authRequired: whether the extension should ask for a key; registration: whether to offer "Register"; email: "off" | "optional" |
// "required"; passwordReset and verifiedEmailRequired: the operator's mail rules.
app.MapGet("/health", () => Results.Ok(new
{
    authRequired = authEnabled,
    registration = registrationOpen,
    email = authEnabled ? emailPolicy.Mode : "off",
    passwordReset = authEnabled && emailPolicy.SmtpConfigured,
    verifiedEmailRequired = authEnabled && emailPolicy.RequireVerified,
}));

if (authEnabled)
    AuthEndpoints.Map(app, registrationOpen);

// "Who am I": the Settings screen uses it to check a key (401 when it is missing or wrong while authentication is on).
app.MapGet("/whoami", (CurrentUser user, HttpContext context) =>
{
    // The user store is only touched when authentication is on, so a companion without it never creates users.db.
    var account = authEnabled && user.Id != 0 ? context.RequestServices.GetRequiredService<IUserStore>().FindByName(user.Name) : null;
    return Results.Ok(new { name = user.Name, authRequired = authEnabled, email = account?.Email, emailVerified = account?.EmailVerified ?? false });
});

app.MapConfigEndpoints();
app.MapBlueprintEndpoints();
app.MapTransformPresetEndpoints();
app.MapGenerateEndpoint();

app.Run();

public partial class Program { }
