namespace ScrapingFactory.Compiler.IR;

// Issue #87: optional, mode-independent (Fields/Groups/Api alike) opt-in —
// after writing the current run's output as always, the generated script
// diffs it against the previous run's output (if any) and only notifies
// when something actually changed. Every credential/target below is an
// *environment variable name*, never a literal value — same "read at
// runtime via os.environ[...]" pattern FillAction.EnvironmentVariableName
// and ApiHeader.EnvironmentVariableName already use, and for the same
// reason: none of this should ever end up baked into the downloaded script.
public sealed class ChangeDetectionConfig
{
    // "Email" or "Webhook" (enforced in ScrapingPlanValidator) — exactly one
    // of Email/Webhook below must be set to match.
    public required string Notify { get; init; }

    public EmailNotificationConfig? Email { get; init; }
    public WebhookNotificationConfig? Webhook { get; init; }
}

public sealed class EmailNotificationConfig
{
    public required string SmtpHostEnvVar { get; init; }

    // Optional: a missing env var (or this being unset) falls back to 587
    // at runtime — see scraper.py.j2's _notify_email. Most SMTP servers
    // listen on 587 (STARTTLS) today, so this is rarely needed.
    public string? SmtpPortEnvVar { get; init; }

    // Optional: an authentication-less internal/local relay is a valid
    // setup — the generated script only calls smtplib's login() when both
    // are configured and actually resolve to a value at runtime.
    public string? SmtpUsernameEnvVar { get; init; }
    public string? SmtpPasswordEnvVar { get; init; }

    public required string FromEnvVar { get; init; }
    public required string ToEnvVar { get; init; }
}

public sealed class WebhookNotificationConfig
{
    public required string UrlEnvVar { get; init; }
}
