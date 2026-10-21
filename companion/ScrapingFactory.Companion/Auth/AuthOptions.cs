using Microsoft.Extensions.Configuration;

namespace ScrapingFactory.Companion.Auth;

// Issue #278: authentication is opt-in. Companion:Auth:Enabled (default false —
// a purely local, single-user companion keeps today's "no login" behavior) set
// in appsettings.json, the per-user settings file (the installer's
// --enable-auth), or Companion__Auth__Enabled=true.
//
// Issue #352: Companion:Auth:Registration (Disabled by default, or Open) lets
// people create their own account from the extension (/auth/register); it only
// makes sense with authentication on, and — because it handles passwords — the
// companion refuses to listen beyond the local machine without TLS (see
// CompanionTls.Validate).
public static class AuthOptions
{
    public const string EnabledKey = "Companion:Auth:Enabled";
    public const string RegistrationKey = "Companion:Auth:Registration";

    public static bool IsEnabled(IConfiguration configuration) => configuration.GetValue<bool>(EnabledKey);

    public static bool IsRegistrationOpen(IConfiguration configuration) =>
        IsEnabled(configuration) && string.Equals(configuration[RegistrationKey], "Open", StringComparison.OrdinalIgnoreCase);

    // Startup check: null = fine, otherwise a message for the operator.
    public static string? Validate(IConfiguration configuration)
    {
        var registration = configuration[RegistrationKey];
        if (string.IsNullOrWhiteSpace(registration))
            return null;
        if (!registration.Equals("Open", StringComparison.OrdinalIgnoreCase) && !registration.Equals("Disabled", StringComparison.OrdinalIgnoreCase))
            return $"Unknown {RegistrationKey} '{registration}' — expected Disabled or Open.";
        if (registration.Equals("Open", StringComparison.OrdinalIgnoreCase) && !IsEnabled(configuration))
            return $"{RegistrationKey}=Open needs authentication ({EnabledKey}=true) — otherwise there would be nothing to register for.";
        return null;
    }
}
