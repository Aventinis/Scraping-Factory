using System.Net.Mail;
using Microsoft.Extensions.Configuration;

namespace ScrapingFactory.Companion.Auth;

public enum SmtpSecurity { StartTls, SslOnConnect, None }

public sealed record SmtpSettings(string Host, int Port, SmtpSecurity Security, string? Username, string? Password, string From);

// What the operator decided about email addresses (Issue #353), all optional
// and off by default — without SMTP nothing about accounts changes.
//
//   Companion:Email:Smtp:Host / Port / Security / Username / Password / From
//        Security = StartTls (default) | SslOnConnect | None (loopback only in a release build)
//   Companion:Auth:Email:Required         ask for an address at registration, and from existing accounts
//   Companion:Auth:Email:RequireVerified  an account without a confirmed address can't use the companion's data
//   Companion:Auth:Email:AllowedDomains   only addresses of these domains (comma-separated or a list)
public sealed record EmailPolicy(bool SmtpConfigured, bool Required, bool RequireVerified, IReadOnlyList<string> AllowedDomains)
{
    // The extension is offered an email field when addresses can be verified or are required.
    public string Mode => Required ? "required" : SmtpConfigured ? "optional" : "off";

    public bool AcceptsEmail => Mode != "off";
}

public static class EmailOptions
{
    public const string SmtpHostKey = "Companion:Email:Smtp:Host";
    public const string RequiredKey = "Companion:Auth:Email:Required";
    public const string RequireVerifiedKey = "Companion:Auth:Email:RequireVerified";
    public const string AllowedDomainsKey = "Companion:Auth:Email:AllowedDomains";

    public static EmailPolicy Read(IConfiguration configuration) =>
        new(
            !string.IsNullOrWhiteSpace(configuration[SmtpHostKey]),
            Flag(configuration, RequiredKey),
            Flag(configuration, RequireVerifiedKey),
            ReadDomains(configuration));

    private static bool Flag(IConfiguration configuration, string key) =>
        bool.TryParse(configuration[key], out var value) && value;

    private static IReadOnlyList<string> ReadDomains(IConfiguration configuration)
    {
        var section = configuration.GetSection(AllowedDomainsKey);
        var raw = new List<string>();
        if (!string.IsNullOrWhiteSpace(section.Value))
            raw.AddRange(section.Value.Split(',', ';', ' '));
        raw.AddRange(section.GetChildren().Select(c => c.Value ?? ""));
        return raw.Select(d => d.Trim().TrimStart('@').ToLowerInvariant()).Where(d => d.Length > 0).Distinct().ToList();
    }

    public static SmtpSettings? ReadSmtp(IConfiguration configuration)
    {
        var host = configuration[SmtpHostKey]?.Trim();
        if (string.IsNullOrEmpty(host))
            return null;
        var section = configuration.GetSection("Companion:Email:Smtp");
        var security = Enum.TryParse<SmtpSecurity>(section["Security"], ignoreCase: true, out var parsed) ? parsed : SmtpSecurity.StartTls;
        var port = int.TryParse(section["Port"], out var configuredPort) ? configuredPort : security == SmtpSecurity.SslOnConnect ? 465 : 587;
        var username = section["Username"];
        return new SmtpSettings(host, port, security, string.IsNullOrEmpty(username) ? null : username, section["Password"], section["From"]?.Trim() ?? "");
    }

    // Startup check: null = fine, otherwise a message for the operator.
    // `developmentBuild` is a parameter (defaulting to the real build) so the rules can be tested for both.
    public static string? Validate(IConfiguration configuration, bool? developmentBuild = null)
    {
        var development = developmentBuild ?? CompanionBuild.IsDevelopment;
        var policy = Read(configuration);

        foreach (var key in new[] { RequiredKey, RequireVerifiedKey })
        {
            var raw = configuration[key];
            if (!string.IsNullOrWhiteSpace(raw) && !bool.TryParse(raw, out _))
                return $"Unknown {key} '{raw}' — expected true or false.";
        }

        if (policy.SmtpConfigured)
        {
            var section = configuration.GetSection("Companion:Email:Smtp");
            var rawSecurity = section["Security"];
            if (!string.IsNullOrWhiteSpace(rawSecurity) && !Enum.TryParse<SmtpSecurity>(rawSecurity, ignoreCase: true, out _))
                return "Unknown Companion:Email:Smtp:Security '" + rawSecurity + "' — expected StartTls, SslOnConnect or None.";
            var rawPort = section["Port"];
            if (!string.IsNullOrWhiteSpace(rawPort) && !(int.TryParse(rawPort, out var port) && port is > 0 and <= 65535))
                return $"Invalid Companion:Email:Smtp:Port '{rawPort}'.";
            var smtp = ReadSmtp(configuration)!;
            if (string.IsNullOrWhiteSpace(smtp.From) || Normalize(smtp.From) is null)
                return "Companion:Email:Smtp:From must be a valid email address (the sender of the messages).";
            if (smtp.Security == SmtpSecurity.None && !CompanionTls.IsLoopbackHost(smtp.Host) && !development)
                return $"Sending mail to '{smtp.Host}' without TLS is not allowed: codes and the SMTP password would travel in clear text. Use Security=StartTls or SslOnConnect.";
            if (smtp.Username is not null && smtp.Security == SmtpSecurity.None && !CompanionTls.IsLoopbackHost(smtp.Host))
                return "SMTP credentials need Security=StartTls or SslOnConnect.";
        }

        var rulesUsed = policy.Required || policy.RequireVerified || policy.AllowedDomains.Count > 0;
        if (rulesUsed && !AuthOptions.IsEnabled(configuration))
            return $"The email rules ({RequiredKey}, {RequireVerifiedKey}, {AllowedDomainsKey}) need authentication ({AuthOptions.EnabledKey}=true).";
        if (policy.RequireVerified && !policy.SmtpConfigured)
            return $"{RequireVerifiedKey}=true needs an SMTP server ({SmtpHostKey}) to send the codes.";
        if (policy.AllowedDomains.Any(d => !d.Contains('.') || d.Contains('@') || d.Contains(' ')))
            return $"{AllowedDomainsKey} must list domains such as 'example.com'.";
        return null;
    }

    // Trimmed and lower-cased, or null when it isn't a plain address (no display name, one '@', a dotted domain).
    public static string? Normalize(string? raw)
    {
        var trimmed = raw?.Trim();
        if (string.IsNullOrEmpty(trimmed) || trimmed.Length > 254 || trimmed.Any(c => char.IsControl(c) || char.IsWhiteSpace(c)))
            return null;
        if (!MailAddress.TryCreate(trimmed, out var address) || !address.Address.Equals(trimmed, StringComparison.Ordinal))
            return null;
        var at = trimmed.IndexOf('@');
        if (at <= 0 || at != trimmed.LastIndexOf('@') || !trimmed[(at + 1)..].Contains('.') || trimmed.EndsWith('.'))
            return null;
        return trimmed.ToLowerInvariant();
    }

    public static bool DomainAllowed(EmailPolicy policy, string normalizedEmail) =>
        policy.AllowedDomains.Count == 0 || policy.AllowedDomains.Contains(normalizedEmail[(normalizedEmail.IndexOf('@') + 1)..]);
}
