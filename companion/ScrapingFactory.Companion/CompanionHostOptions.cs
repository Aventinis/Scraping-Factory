using Microsoft.Extensions.Configuration;

namespace ScrapingFactory.Companion;

// The companion app used to bind to a single hardcoded "http://localhost:5000"
// — fine for a single machine, but it broke the moment that port was already
// taken or the extension needed to reach a companion instance running
// elsewhere (e.g. a VM/container). Both Host and Port now come from the
// "Companion" section of appsettings.json (or an environment
// variable/CLI override, e.g. Companion__Port=5050 — the standard ASP.NET
// Core configuration precedence applies), falling back to the same
// localhost:5000 default this app always used.
public static class CompanionHostOptions
{
    public const string DefaultHost = "localhost";
    public const int DefaultPort = 5000;

    public static string BuildListenUrl(IConfiguration configuration)
    {
        var host = configuration["Companion:Host"];
        if (string.IsNullOrWhiteSpace(host))
            host = DefaultHost;

        var port = configuration.GetValue<int?>("Companion:Port") ?? DefaultPort;

        return $"http://{host}:{port}";
    }
}
