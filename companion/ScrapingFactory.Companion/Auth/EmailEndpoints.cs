namespace ScrapingFactory.Companion.Auth;

public sealed class CodeRequest
{
    public string? Code { get; set; }
}

public sealed class SetEmailRequest
{
    public string? Email { get; set; }
    public string? CurrentPassword { get; set; }
}

public sealed class ForgotPasswordRequest
{
    // A user name or the (verified) email address of the account.
    public string? Account { get; set; }
}

public sealed class ResetPasswordRequest
{
    public string? Account { get; set; }
    public string? Code { get; set; }
    public string? NewPassword { get; set; }
}

// Issue #353: confirming an email address and resetting a forgotten password
// with a one-time code mailed to it. verify-email / resend-verification /
// set-email need a signed-in user; forgot-password / reset-password are
// reachable without a key (a person who forgot the password has none).
//
// A reset code is only ever sent to a *verified* address: an unverified one may
// be a typo or someone else's, and mailing a reset code there would hand that
// person the account. forgot-password answers the same for every input, so it
// can't be used to find out which names or addresses exist.
public static class EmailEndpoints
{
    private const string ForgotAnswer = "If that account has a verified email address, a code is on its way.";
    private const string ResetFailed = "The code is wrong or has expired.";

    public static void Map(WebApplication app, EmailPolicy policy)
    {
        app.MapPost("/auth/verify-email", (CodeRequest? request, CurrentUser current, IUserStore users) =>
        {
            if (SignedIn(current, users) is not { } user)
                return Results.BadRequest(new { error = "Not signed in." });
            if (user.Email is null)
                return Results.BadRequest(new { error = "This account has no email address." });
            if (user.EmailVerified)
                return Results.Ok(new { emailVerified = true });
            if (EmailCodes.Normalize(request?.Code) is not { } code)
                return Results.BadRequest(new { error = $"Enter the {EmailCodes.Digits}-digit code from the email." });

            var result = users.CheckEmailCode(user.Id, EmailCodePurpose.Verify, EmailCodes.Hash(user.Id, EmailCodePurpose.Verify, code), DateTimeOffset.UtcNow, EmailCodes.MaxAttempts);
            switch (result)
            {
                case EmailCodeResult.Valid:
                    users.SetEmailVerified(user.Id, true);
                    return Results.Ok(new { emailVerified = true });
                case EmailCodeResult.Wrong:
                    return Results.BadRequest(new { error = "The code is wrong." });
                case EmailCodeResult.TooManyAttempts:
                    return Results.BadRequest(new { error = "Too many wrong codes - ask for a new one." });
                default:
                    return Results.BadRequest(new { error = "The code has expired or was never requested - ask for a new one." });
            }
        });

        app.MapPost("/auth/resend-verification", async (CurrentUser current, HttpContext context, IUserStore users, EmailService emails, EmailThrottle throttle) =>
        {
            if (SignedIn(current, users) is not { } user)
                return Results.BadRequest(new { error = "Not signed in." });
            if (!policy.SmtpConfigured)
                return Results.BadRequest(new { error = "This companion cannot send email." });
            if (user.Email is null)
                return Results.BadRequest(new { error = "This account has no email address." });
            if (user.EmailVerified)
                return Results.BadRequest(new { error = "The email address is already verified." });
            return await Issue(emails, throttle, user, EmailCodePurpose.Verify, AuthEndpoints.AddressOf(context));
        });

        app.MapPost("/auth/set-email", async (SetEmailRequest? request, CurrentUser current, HttpContext context, IUserStore users, LoginThrottle loginThrottle, EmailService emails, EmailThrottle throttle) =>
        {
            if (SignedIn(current, users) is not { } user)
                return Results.BadRequest(new { error = "Not signed in." });
            if (!policy.AcceptsEmail)
                return Results.BadRequest(new { error = "This companion does not collect email addresses." });

            // Changing the address is what a thief with a stolen token would do
            // first (then "forgot password" mails the thief), so an account with a
            // password has to confirm it. A key-only account has none to confirm.
            var stored = users.GetPasswordHash(user.Name);
            if (stored is not null)
            {
                var wait = loginThrottle.RetryAfterSeconds(AuthEndpoints.AddressOf(context), user.Name);
                if (wait > 0)
                    return AuthEndpoints.RateLimited(wait);
                if (!PasswordHasher.Verify(request?.CurrentPassword ?? "", stored))
                {
                    loginThrottle.RecordFailure(user.Name);
                    return Results.Json(new { error = "The current password is wrong." }, statusCode: StatusCodes.Status401Unauthorized);
                }
            }

            var (email, problem) = AuthEndpoints.CheckEmail(policy with { Required = true }, request?.Email);
            if (problem is not null)
                return Results.BadRequest(new { error = problem });
            if (email == user.Email)
                return Results.Ok(AuthEndpoints.Payload(user, null, null));

            try
            {
                users.SetEmail(user.Id, email, verified: false);
            }
            catch (EmailInUseException)
            {
                return Results.Conflict(new { error = "That email address is already registered." });
            }

            var changed = users.FindByName(user.Name)!;
            var sent = false;
            if (policy.SmtpConfigured)
                sent = (await emails.IssueCodeAsync(changed, EmailCodePurpose.Verify, AuthEndpoints.AddressOf(context), inBackground: false)).Outcome == IssueOutcome.Sent;
            return Results.Ok(AuthEndpoints.Payload(changed, null, sent));
        });

        app.MapPost("/auth/forgot-password", async (ForgotPasswordRequest? request, HttpContext context, IUserStore users, EmailService emails, EmailThrottle throttle) =>
        {
            if (!policy.SmtpConfigured)
                return Results.BadRequest(new { error = "Password reset by email is not available on this companion." });

            var address = AuthEndpoints.AddressOf(context);
            var wait = throttle.RetryAfterSeconds(address, null);
            if (wait > 0)
                return AuthEndpoints.RateLimited(wait);
            throttle.RecordRequest(address);

            if (Resolve(users, request?.Account) is { Disabled: false, EmailVerified: true, Email: not null } user)
                await emails.IssueCodeAsync(user, EmailCodePurpose.Reset, address, inBackground: true);
            return Results.Accepted(value: new { message = ForgotAnswer });
        });

        app.MapPost("/auth/reset-password", (ResetPasswordRequest? request, HttpContext context, IUserStore users, EmailThrottle throttle) =>
        {
            var address = AuthEndpoints.AddressOf(context);
            // Throttled by what was typed, not by whether such an account exists.
            var key = (request?.Account ?? "").Trim().ToLowerInvariant();
            var wait = throttle.RetryAfterSeconds(address, key);
            if (wait > 0)
                return AuthEndpoints.RateLimited(wait);
            throttle.RecordRequest(address);

            var user = Resolve(users, request?.Account);
            if (PasswordHasher.CheckPolicy(request?.NewPassword, user?.Name ?? key) is { } problem)
                return Results.BadRequest(new { error = problem });

            if (user is { Disabled: false, EmailVerified: true, Email: not null } && EmailCodes.Normalize(request?.Code) is { } code)
            {
                var result = users.CheckEmailCode(user.Id, EmailCodePurpose.Reset, EmailCodes.Hash(user.Id, EmailCodePurpose.Reset, code), DateTimeOffset.UtcNow, EmailCodes.MaxAttempts);
                if (result == EmailCodeResult.Valid)
                {
                    users.SetPassword(user.Name, PasswordHasher.Hash(request!.NewPassword!));
                    // Every device has to sign in again with the new password.
                    users.RevokeTokens(user.Id);
                    users.DeleteEmailCodes(user.Id);
                    throttle.Clear(key);
                    return Results.NoContent();
                }
            }
            throttle.RecordFailedCode(key);
            return Results.BadRequest(new { error = ResetFailed });
        });
    }

    private static UserRecord? SignedIn(CurrentUser current, IUserStore users) =>
        current.Id == 0 ? null : users.FindByName(current.Name);

    // A user name, or an email address (anything with an '@').
    private static UserRecord? Resolve(IUserStore users, string? account)
    {
        var typed = account?.Trim();
        if (string.IsNullOrEmpty(typed))
            return null;
        if (typed.Contains('@'))
            return EmailOptions.Normalize(typed) is { } email ? users.FindByEmail(email) : null;
        return users.FindByName(typed);
    }

    private static async Task<IResult> Issue(EmailService emails, EmailThrottle throttle, UserRecord user, string purpose, string address)
    {
        throttle.RecordRequest(address);
        var result = await emails.IssueCodeAsync(user, purpose, address, inBackground: false);
        return result.Outcome switch
        {
            IssueOutcome.Sent => Results.Accepted(value: new { sent = true }),
            IssueOutcome.Cooldown or IssueOutcome.Throttled => AuthEndpoints.RateLimited(result.RetryAfterSeconds,
                $"Please wait {result.RetryAfterSeconds} seconds before asking for another email."),
            IssueOutcome.SendFailed => Results.Json(new { error = "The email could not be sent - ask whoever runs the companion to check the mail settings." }, statusCode: StatusCodes.Status502BadGateway),
            _ => Results.BadRequest(new { error = "This companion cannot send email." }),
        };
    }
}
