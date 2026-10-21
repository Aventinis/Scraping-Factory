namespace ScrapingFactory.Companion.Auth;

public sealed class CredentialsRequest
{
    public string? Name { get; set; }
    public string? Password { get; set; }
    // Free text shown in a future "signed-in devices" list, e.g. "Browser extension".
    public string? Device { get; set; }
    // Issue #353: optional (or required, see EmailPolicy) at registration.
    public string? Email { get; set; }
}

public sealed class ChangePasswordRequest
{
    public string? CurrentPassword { get; set; }
    public string? NewPassword { get; set; }
}

// Issue #352: self-service accounts. register/login are reachable without an
// access key (like /health); the others need one. A successful register/login
// hands the extension a per-device token — the same `Authorization: Bearer`
// mechanism as a key from `user add`, but individually revocable (logout,
// logout-all, a password change). The messages never reveal whether a user
// name exists: a wrong password and an unknown name look and cost the same.
public static class AuthEndpoints
{
    private const string InvalidCredentials = "Invalid user name or password.";

    public static void Map(WebApplication app, bool registrationOpen)
    {
        var emailPolicy = EmailOptions.Read(app.Configuration);
        EmailEndpoints.Map(app, emailPolicy);

        app.MapPost("/auth/register", async (CredentialsRequest? request, HttpContext context, IUserStore users, LoginThrottle throttle, EmailService emails) =>
        {
            if (!registrationOpen)
                return Results.Json(new { error = "Registration is not enabled on this companion." }, statusCode: StatusCodes.Status403Forbidden);

            var address = AddressOf(context);
            if (Throttled(throttle, address, null) is { } limited)
                return limited;
            throttle.RecordAttempt(address);

            var name = request?.Name?.Trim();
            if (!UserNames.IsValid(name))
                return Results.BadRequest(new { error = $"Invalid user name: {UserNames.Rules}." });
            if (PasswordHasher.CheckPolicy(request!.Password, name!) is { } problem)
                return Results.BadRequest(new { error = problem });

            var (email, emailProblem) = CheckEmail(emailPolicy, request.Email);
            if (emailProblem is not null)
                return Results.BadRequest(new { error = emailProblem });

            UserRecord user;
            try
            {
                user = users.CreateWithPassword(name!, PasswordHasher.Hash(request.Password!), email);
            }
            catch (EmailInUseException)
            {
                return Results.Conflict(new { error = "That email address is already registered." });
            }
            catch (InvalidOperationException)
            {
                return Results.Conflict(new { error = "That user name is already taken." });
            }
            var token = users.CreateToken(user.Id, DeviceLabel(request.Device));

            // A new address is unverified: mail the code right away (the account
            // exists either way; "Send the code again" is in the extension).
            var verificationSent = false;
            if (email is not null && emailPolicy.SmtpConfigured)
                verificationSent = (await emails.IssueCodeAsync(user, EmailCodePurpose.Verify, address, inBackground: false)).Outcome == IssueOutcome.Sent;
            return Results.Created("/whoami", Payload(user, token, verificationSent));
        });

        app.MapPost("/auth/login", (CredentialsRequest? request, HttpContext context, IUserStore users, LoginThrottle throttle) =>
        {
            var address = AddressOf(context);
            var name = request?.Name?.Trim() ?? "";
            if (Throttled(throttle, address, name) is { } limited)
                return limited;
            throttle.RecordAttempt(address);

            var user = name.Length > 0 ? users.FindByName(name) : null;
            var stored = user is null ? null : users.GetPasswordHash(user.Name);
            // Verify against a dummy hash when there is nothing to verify, so
            // timing doesn't tell an unknown name from a wrong password.
            var passwordOk = PasswordHasher.Verify(request?.Password ?? "", stored ?? PasswordHasher.DummyHash) && stored is not null;
            if (user is null || user.Disabled || !passwordOk)
            {
                if (name.Length > 0)
                    throttle.RecordFailure(name);
                return Results.Json(new { error = InvalidCredentials }, statusCode: StatusCodes.Status401Unauthorized);
            }

            throttle.ClearFailures(name);
            return Results.Ok(Payload(user, users.CreateToken(user.Id, DeviceLabel(request?.Device)), null));
        });

        app.MapPost("/auth/logout", (HttpContext context, IUserStore users) =>
        {
            var token = BearerToken(context);
            if (token.Length > 0)
                users.RevokeToken(token);
            return Results.NoContent();
        });

        app.MapPost("/auth/logout-all", (CurrentUser user, IUserStore users) =>
        {
            users.RevokeTokens(user.Id);
            return Results.NoContent();
        });

        app.MapPost("/auth/change-password", (ChangePasswordRequest? request, CurrentUser user, HttpContext context, IUserStore users, LoginThrottle throttle) =>
        {
            if (user.Id == 0)
                return Results.BadRequest(new { error = "Not signed in." });
            if (Throttled(throttle, AddressOf(context), user.Name) is { } limited)
                return limited;

            // A user who only has an access key (created by `user add`) has no
            // password yet and may set a first one without giving a current one.
            var stored = users.GetPasswordHash(user.Name);
            if (stored is not null && !PasswordHasher.Verify(request?.CurrentPassword ?? "", stored))
            {
                throttle.RecordFailure(user.Name);
                return Results.Json(new { error = "The current password is wrong." }, statusCode: StatusCodes.Status401Unauthorized);
            }
            if (PasswordHasher.CheckPolicy(request?.NewPassword, user.Name) is { } problem)
                return Results.BadRequest(new { error = problem });

            users.SetPassword(user.Name, PasswordHasher.Hash(request!.NewPassword!));
            // Every other device has to sign in again with the new password.
            users.RevokeTokens(user.Id, exceptToken: BearerToken(context));
            throttle.ClearFailures(user.Name);
            return Results.NoContent();
        });
    }

    // What register/login hand back: who, the device token, and the email state.
    internal static object Payload(UserRecord user, string? token, bool? verificationSent) => new
    {
        name = user.Name,
        token,
        email = user.Email,
        emailVerified = user.EmailVerified,
        verificationSent,
    };

    // The normalized address (or null) and, when it isn't acceptable, why. Shared
    // by registration and "set email".
    internal static (string? Email, string? Problem) CheckEmail(EmailPolicy policy, string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return policy.Required ? (null, "An email address is required.") : (null, null);
        if (!policy.AcceptsEmail)
            return (null, "This companion does not collect email addresses.");
        var email = EmailOptions.Normalize(raw);
        if (email is null)
            return (null, "That is not a valid email address.");
        if (!EmailOptions.DomainAllowed(policy, email))
            return (null, $"Email addresses of this domain are not accepted (allowed: {string.Join(", ", policy.AllowedDomains)}).");
        return (email, null);
    }

    private static IResult? Throttled(LoginThrottle throttle, string address, string? name)
    {
        var wait = throttle.RetryAfterSeconds(address, name);
        return wait <= 0 ? null : RateLimited(wait);
    }

    internal static IResult RateLimited(int wait, string? message = null) =>
        new RetryAfterResult(
            Results.Json(new { error = message ?? $"Too many attempts — try again in {wait} seconds." }, statusCode: StatusCodes.Status429TooManyRequests), wait);

    private sealed class RetryAfterResult(IResult inner, int seconds) : IResult
    {
        public Task ExecuteAsync(HttpContext httpContext)
        {
            httpContext.Response.Headers.RetryAfter = seconds.ToString();
            return inner.ExecuteAsync(httpContext);
        }
    }

    internal static string AddressOf(HttpContext context) => context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    private static string DeviceLabel(string? device) =>
        string.IsNullOrWhiteSpace(device) ? "extension" : device.Trim()[..Math.Min(device.Trim().Length, 100)];

    public static string BearerToken(HttpContext context)
    {
        var header = context.Request.Headers.Authorization.ToString();
        return header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? header["Bearer ".Length..].Trim() : "";
    }
}
