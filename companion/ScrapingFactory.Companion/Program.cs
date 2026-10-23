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

// Issue #346: optional per-user settings file (written by the installer).
CompanionUserSettings.Apply(builder.Configuration, args);

// Issue #278: `ScrapingFactory.Companion user add <name>` etc. — user
// administration on the machine running the companion, no web host started.
if (UserCommands.IsUserCommand(args))
{
    Environment.ExitCode = UserCommands.Run(args, builder.Configuration);
    return;
}

// Issue #352: refuse configurations that would send passwords/keys in clear
// text beyond this machine, and set up HTTPS when it is configured.
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
// /health and /generate never touch it. Issue #276: all three stores are
// registered and injected by interface (ISavedConfigStore/IOutputBlueprintStore/
// ITransformPresetStore). Issue #277: which implementation backs them (SQLite,
// the default, or MySQL) is picked from Companion:Storage:* by StorageOptions.
builder.Services.AddSingleton<ISavedConfigStore>(sp => StorageOptions.CreateSavedConfigStore(sp.GetRequiredService<IConfiguration>()));

// Issue #191: same lazy-construction reasoning as SavedConfigStore above,
// its own independent store/SQLite file — see OutputBlueprintStore's own
// doc comment for why this isn't just a third table there.
builder.Services.AddSingleton<IOutputBlueprintStore>(sp => StorageOptions.CreateOutputBlueprintStore(sp.GetRequiredService<IConfiguration>()));

// Issue #279: same lazy-construction reasoning, its own SQLite file — see
// TransformPresetStore's own doc comment.
builder.Services.AddSingleton<ITransformPresetStore>(sp => StorageOptions.CreateTransformPresetStore(sp.GetRequiredService<IConfiguration>()));

// Issue #278: the users behind the access keys, in the same backend as the data.
builder.Services.AddSingleton<IUserStore>(sp => StorageOptions.CreateUserStore(sp.GetRequiredService<IConfiguration>()));

// Issue #352: abuse protection for /auth/login and /auth/register.
builder.Services.AddSingleton<LoginThrottle>();

// Issue #353: email addresses, verification and password reset — the sender
// (SMTP when configured), the throttle for mail-sending endpoints and the
// service that issues codes.
builder.Services.AddSingleton<IEmailSender>(sp =>
    EmailOptions.ReadSmtp(sp.GetRequiredService<IConfiguration>()) is { } smtp ? new SmtpEmailSender(smtp) : new NoEmailSender());
builder.Services.AddSingleton<EmailThrottle>();
builder.Services.AddSingleton<EmailService>();

var app = builder.Build();

// Issue #277: fail fast on an unknown storage provider / missing MySQL
// connection string (no connection is opened here).
StorageOptions.Validate(app.Configuration);

app.UseCors();

// Issue #277: an unreachable or misconfigured MySQL database only shows up
// when a store is first used (the stores are created lazily, so /health and
// /generate never need the database) — answer 503 with the driver's message
// instead of an anonymous 500.
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

// Issue #278: optional per-user authentication (Companion:Auth:Enabled, off by
// default — a local single-user companion keeps today's "no login" behavior).
// When on, every request except /health (and CORS preflights) must carry
// `Authorization: Bearer <access key>`; the key resolves to the user whose data
// every store call is then scoped to (CurrentUser). Without it everything runs
// as the anonymous owner 0, exactly as before.
var authEnabled = AuthOptions.IsEnabled(app.Configuration);
var registrationOpen = AuthOptions.IsRegistrationOpen(app.Configuration);
var emailPolicy = EmailOptions.Read(app.Configuration);
app.Use(async (context, next) =>
{
    // /health and, for self-service accounts (Issue #352), the two endpoints a
    // person without a key has to be able to reach.
    var anonymous = context.Request.Path == "/health"
        || context.Request.Path == "/auth/register" || context.Request.Path == "/auth/login"
        // Issue #353: a person who forgot the password has no key.
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

    // Issue #353: with RequireVerified, an account without a confirmed email
    // address can sign in and see who it is, and use the account endpoints to
    // confirm one — but not the companion's data. (A 403 with a code the
    // extension recognizes, not a 401: the key itself is fine.)
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

// authRequired lets the extension know whether to ask for / validate a key.
// registration tells the extension whether to offer "Register" (Issue #352).
// Issue #353: email = whether the extension should ask for an address
// ("off" | "optional" | "required"), passwordReset = whether a forgotten
// password can be reset by email, verifiedEmailRequired = the operator's rule.
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

// Issue #278: "who am I" — the extension's Settings screen uses it to check a
// key (401 when the key is missing/wrong while authentication is on).
app.MapGet("/whoami", (CurrentUser user, HttpContext context) =>
{
    // Issue #353: the account's email state (when there is an account). The
    // user store is only touched when authentication is on, so a companion
    // without it never creates users.db.
    var account = authEnabled && user.Id != 0 ? context.RequestServices.GetRequiredService<IUserStore>().FindByName(user.Name) : null;
    return Results.Ok(new { name = user.Name, authRequired = authEnabled, email = account?.Email, emailVerified = account?.EmailVerified ?? false });
});

app.MapConfigEndpoints();
app.MapBlueprintEndpoints();
app.MapTransformPresetEndpoints();
app.MapGenerateEndpoint();

app.Run();

public partial class Program { }
