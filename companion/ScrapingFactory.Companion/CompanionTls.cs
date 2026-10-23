using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Microsoft.Extensions.Configuration;

namespace ScrapingFactory.Companion;

public enum TlsMode { Off, Certificate, SelfSigned }

// HTTPS for the companion. Passwords and access keys travel between extension and companion, so a companion reachable
// beyond the local machine must speak TLS:
//
//   Companion:Tls:Mode = Off          plain HTTP (default); only allowed on a loopback address (a single-user setup, or
//                                     behind a TLS-terminating reverse proxy).
//   Companion:Tls:Mode = Certificate  a real certificate: CertificatePath (.pfx + CertificatePassword, or PEM +
//                                     CertificateKeyPath).
//   Companion:Tls:Mode = SelfSigned   a self-signed certificate generated on first start; development builds only.
//   Companion:Tls:AllowInsecureRemote = true  plain HTTP on a non-local address; development builds only.
public static class CompanionTls
{
    public static TlsMode ReadMode(IConfiguration configuration) =>
        Enum.TryParse<TlsMode>(configuration["Companion:Tls:Mode"], ignoreCase: true, out var mode) ? mode : TlsMode.Off;

    public static bool IsEnabled(IConfiguration configuration) => ReadMode(configuration) != TlsMode.Off;

    public static bool IsLoopbackHost(string? host)
    {
        if (string.IsNullOrWhiteSpace(host))
            return true; // the default host is localhost
        var trimmed = host.Trim().Trim('[', ']');
        if (trimmed.Equals("localhost", StringComparison.OrdinalIgnoreCase))
            return true;
        return IPAddress.TryParse(trimmed, out var address) && IPAddress.IsLoopback(address);
    }

    // Returns an error message when the combination of host, TLS mode and
    // build is not allowed, otherwise null. `developmentBuild` is a parameter
    // (defaulting to the real build) so the rules can be tested for both.
    public static string? Validate(IConfiguration configuration, bool? developmentBuild = null)
    {
        var development = developmentBuild ?? CompanionBuild.IsDevelopment;
        var rawMode = configuration["Companion:Tls:Mode"];
        if (!string.IsNullOrWhiteSpace(rawMode) && !Enum.TryParse<TlsMode>(rawMode, ignoreCase: true, out _))
            return $"Unknown Companion:Tls:Mode '{rawMode}' — expected Off, Certificate or SelfSigned.";

        var mode = ReadMode(configuration);
        switch (mode)
        {
            case TlsMode.SelfSigned when !development:
                return "Companion:Tls:Mode=SelfSigned is only available in development builds — a self-signed certificate is not something to hand to users. Use Mode=Certificate with a real certificate.";
            case TlsMode.Certificate:
                var path = configuration["Companion:Tls:CertificatePath"];
                if (string.IsNullOrWhiteSpace(path))
                    return "Companion:Tls:Mode=Certificate needs Companion:Tls:CertificatePath (a .pfx file, or a PEM certificate plus Companion:Tls:CertificateKeyPath).";
                if (!File.Exists(path))
                    return $"The TLS certificate file '{path}' does not exist.";
                var keyPath = configuration["Companion:Tls:CertificateKeyPath"];
                if (!string.IsNullOrWhiteSpace(keyPath) && !File.Exists(keyPath))
                    return $"The TLS certificate key file '{keyPath}' does not exist.";
                break;
            case TlsMode.Off:
                var host = configuration["Companion:Host"];
                if (!IsLoopbackHost(host))
                {
                    var allowed = development && configuration.GetValue<bool>("Companion:Tls:AllowInsecureRemote");
                    if (!allowed)
                        return $"Listening on '{host}' without TLS is not allowed: passwords and access keys would travel in clear text. Configure HTTPS (Companion:Tls:Mode=Certificate), or bind to localhost behind a TLS-terminating reverse proxy.";
                }
                break;
        }
        return null;
    }

    public static string ResolveSelfSignedPath(IConfiguration configuration)
    {
        var configured = configuration["Companion:Tls:SelfSignedPath"];
        if (!string.IsNullOrWhiteSpace(configured))
            return configured;
        var appDataDir = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData, Environment.SpecialFolderOption.Create);
        var dir = Path.Combine(appDataDir, "ScrapingFactory");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, "dev-certificate.pfx");
    }

    // The certificate Kestrel serves. Call Validate first.
    public static X509Certificate2 LoadCertificate(IConfiguration configuration, out string description)
    {
        switch (ReadMode(configuration))
        {
            case TlsMode.SelfSigned:
            {
                var path = ResolveSelfSignedPath(configuration);
                var certificate = LoadOrCreateSelfSigned(path, configuration["Companion:Host"]);
                description = $"self-signed development certificate {path} (SHA-256 {certificate.GetCertHashString(HashAlgorithmName.SHA256)})";
                return certificate;
            }
            default:
            {
                var path = configuration["Companion:Tls:CertificatePath"]!;
                var keyPath = configuration["Companion:Tls:CertificateKeyPath"];
                var password = configuration["Companion:Tls:CertificatePassword"];
                var certificate = !string.IsNullOrWhiteSpace(keyPath)
                    ? X509Certificate2.CreateFromPemFile(path, keyPath)
                    : path.EndsWith(".pem", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".crt", StringComparison.OrdinalIgnoreCase)
                        ? X509Certificate2.CreateFromPemFile(path)
                        : X509CertificateLoader.LoadPkcs12FromFile(path, string.IsNullOrEmpty(password) ? null : password);
                description = $"certificate {path}";
                return certificate;
            }
        }
    }

    // A development certificate for localhost, regenerated when missing, unreadable or about to expire. A throwaway key.
    public static X509Certificate2 LoadOrCreateSelfSigned(string path, string? host = null)
    {
        if (File.Exists(path))
        {
            try
            {
                var existing = X509CertificateLoader.LoadPkcs12FromFile(path, null);
                if (existing.NotAfter > DateTime.UtcNow.AddDays(30))
                    return existing;
            }
            catch (CryptographicException)
            {
                // unreadable — replaced below
            }
        }

        using var rsa = RSA.Create(2048);
        var request = new CertificateRequest("CN=Scraping Factory companion (development)", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var names = new SubjectAlternativeNameBuilder();
        names.AddDnsName("localhost");
        names.AddIpAddress(IPAddress.Loopback);
        names.AddIpAddress(IPAddress.IPv6Loopback);
        if (!string.IsNullOrWhiteSpace(host) && !IsLoopbackHost(host) && host is not ("0.0.0.0" or "*" or "+"))
        {
            if (IPAddress.TryParse(host.Trim('[', ']'), out var address)) names.AddIpAddress(address);
            else names.AddDnsName(host);
        }
        request.CertificateExtensions.Add(names.Build());
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, false));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
        request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension([new Oid("1.3.6.1.5.5.7.3.1")], false));

        using var created = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(1));
        var pfx = created.Export(X509ContentType.Pfx);
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        File.WriteAllBytes(path, pfx);
        if (!OperatingSystem.IsWindows())
            File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        return X509CertificateLoader.LoadPkcs12(pfx, null);
    }
}
