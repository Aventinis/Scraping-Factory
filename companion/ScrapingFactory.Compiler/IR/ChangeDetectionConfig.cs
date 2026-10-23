namespace ScrapingFactory.Compiler.IR;

// After writing its output the script diffs it against the previous run's and notifies only on a change. Every
// credential/target is an environment variable *name*, never a literal.
public sealed class ChangeDetectionConfig
{
    // "Email" or "Webhook"; exactly the matching sub-config must be set.
    public required string Notify { get; init; }

    public EmailNotificationConfig? Email { get; init; }
    public WebhookNotificationConfig? Webhook { get; init; }
}

public sealed class EmailNotificationConfig
{
    public required string SmtpHostEnvVar { get; init; }

    // Optional; the port defaults to 587.
    public string? SmtpPortEnvVar { get; init; }

    // Optional: login() is only called when both resolve to a value (an unauthenticated relay is valid).
    public string? SmtpUsernameEnvVar { get; init; }
    public string? SmtpPasswordEnvVar { get; init; }

    public required string FromEnvVar { get; init; }
    public required string ToEnvVar { get; init; }
}

public sealed class WebhookNotificationConfig
{
    public required string UrlEnvVar { get; init; }
}
