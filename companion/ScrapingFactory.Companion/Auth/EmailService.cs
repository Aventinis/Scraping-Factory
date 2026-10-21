namespace ScrapingFactory.Companion.Auth;

// Issue #353: abuse protection for the endpoints that send mail — a small
// in-memory window like LoginThrottle (same implementation, other limits): per
// client address how often mail can be asked for, and per account how many
// codes may be mailed per hour. A restart forgets it; the cooldown between two
// mails to one account is additionally kept in the database (EmailCodes).
public sealed class EmailThrottle
{
    private readonly LoginThrottle _inner;

    public EmailThrottle(Func<DateTimeOffset>? clock = null) => _inner = new LoginThrottle(clock)
    {
        MaxFailuresPerUser = 5,
        UserWindow = TimeSpan.FromHours(1),
        MaxAttemptsPerAddress = 20,
        AddressWindow = TimeSpan.FromMinutes(10),
    };

    // Seconds to wait (address and account together), 0 = fine.
    public int RetryAfterSeconds(string address, string? userName) => _inner.RetryAfterSeconds(address, userName);

    public void RecordRequest(string address) => _inner.RecordAttempt(address);

    public void RecordMailSent(string userName) => _inner.RecordFailure(userName);

    // Wrong codes in /auth/reset-password count like wrong passwords: a lockout per account.
    public void RecordFailedCode(string userName) => _inner.RecordFailure(userName);

    public void Clear(string userName) => _inner.ClearFailures(userName);
}

public enum IssueOutcome { Sent, SendFailed, Cooldown, Throttled, NotPossible }

public sealed record IssueResult(IssueOutcome Outcome, int RetryAfterSeconds = 0);

// Issue #353: creates a one-time code for a user and mails it.
public sealed class EmailService(
    IUserStore users, IEmailSender sender, IConfiguration configuration, EmailThrottle throttle, ILogger<EmailService> log)
{
    public static readonly TimeSpan Cooldown = TimeSpan.FromSeconds(60);

    public EmailPolicy Policy => EmailOptions.Read(configuration);

    // `purpose` is EmailCodePurpose.Verify or .Reset. The code reaches the person
    // only by mail; it is never logged. With `inBackground` the call returns once
    // the code is stored and the mail is queued (so the response time can't tell
    // a known address from an unknown one); otherwise it waits for the SMTP
    // server and reports SendFailed.
    public async Task<IssueResult> IssueCodeAsync(UserRecord user, string purpose, string address, bool inBackground)
    {
        if (!Policy.SmtpConfigured || string.IsNullOrEmpty(user.Email))
            return new IssueResult(IssueOutcome.NotPossible);

        var wait = throttle.RetryAfterSeconds(address, user.Name);
        if (wait > 0)
            return new IssueResult(IssueOutcome.Throttled, wait);
        if (users.EmailCodeSentAt(user.Id, purpose) is { } sentAt && DateTimeOffset.UtcNow - sentAt < Cooldown)
            return new IssueResult(IssueOutcome.Cooldown, (int)Math.Ceiling((sentAt + Cooldown - DateTimeOffset.UtcNow).TotalSeconds));

        var code = EmailCodes.Generate();
        users.SaveEmailCode(user.Id, purpose, EmailCodes.Hash(user.Id, purpose, code), DateTimeOffset.UtcNow + EmailCodes.Lifetime(purpose));
        throttle.RecordMailSent(user.Name);

        var message = purpose == EmailCodePurpose.Reset
            ? EmailMessages.PasswordReset(user.Email, user.Name, code)
            : EmailMessages.Verification(user.Email, user.Name, code);

        if (inBackground)
        {
            _ = Task.Run(async () =>
            {
                try { await sender.SendAsync(message); }
                catch (Exception exception) { log.LogWarning("Could not send a {Purpose} mail: {Reason}", purpose, exception.Message); }
            });
            return new IssueResult(IssueOutcome.Sent);
        }

        try
        {
            await sender.SendAsync(message);
            return new IssueResult(IssueOutcome.Sent);
        }
        catch (Exception exception)
        {
            log.LogWarning("Could not send a {Purpose} mail: {Reason}", purpose, exception.Message);
            return new IssueResult(IssueOutcome.SendFailed);
        }
    }
}
