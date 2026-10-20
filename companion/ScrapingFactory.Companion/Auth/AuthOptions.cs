using Microsoft.Extensions.Configuration;

namespace ScrapingFactory.Companion.Auth;

// Issue #278: authentication is opt-in. Companion:Auth:Enabled (default false —
// a purely local, single-user companion keeps today's "no login" behavior) set
// in appsettings.json, the per-user settings file (the installer's
// --enable-auth), or Companion__Auth__Enabled=true.
public static class AuthOptions
{
    public const string EnabledKey = "Companion:Auth:Enabled";

    public static bool IsEnabled(IConfiguration configuration) => configuration.GetValue<bool>(EnabledKey);
}
