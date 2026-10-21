using System.Net;
using System.Security.Cryptography.X509Certificates;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using ScrapingFactory.Companion;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #352: HTTPS for the companion. The rules that keep passwords off the
// wire (non-local plain HTTP is refused, self-signed certificates exist only in
// development builds) are tested for both build kinds, and a real HTTPS server
// proves the certificate Kestrel serves.
public class CompanionTlsTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("sf-tls-").FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private static IConfiguration Config(params (string Key, string? Value)[] values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values.ToDictionary(v => v.Key, v => v.Value)).Build();

    // ── Validation ───────────────────────────────────────────────────────────

    [Theory]
    [InlineData(null, true)]
    [InlineData("", true)]
    [InlineData("localhost", true)]
    [InlineData("LOCALHOST", true)]
    [InlineData("127.0.0.1", true)]
    [InlineData("127.5.4.3", true)]
    [InlineData("::1", true)]
    [InlineData("[::1]", true)]
    [InlineData("0.0.0.0", false)]
    [InlineData("*", false)]
    [InlineData("192.168.1.20", false)]
    [InlineData("example.com", false)]
    public void LoopbackDetection(string? host, bool loopback) => Assert.Equal(loopback, CompanionTls.IsLoopbackHost(host));

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void PlainHttpOnLocalhost_IsAlwaysFine(bool development) =>
        Assert.Null(CompanionTls.Validate(Config(), development));

    [Fact]
    public void PlainHttpBeyondThisMachine_IsRefusedInAReleaseBuild()
    {
        var error = CompanionTls.Validate(Config(("Companion:Host", "0.0.0.0")), developmentBuild: false);
        Assert.Contains("without TLS is not allowed", error);
        Assert.Contains("0.0.0.0", error);
    }

    [Fact]
    public void ThePlainHttpEscapeHatch_OnlyWorksInADevelopmentBuild()
    {
        var config = Config(("Companion:Host", "0.0.0.0"), ("Companion:Tls:AllowInsecureRemote", "true"));
        Assert.Null(CompanionTls.Validate(config, developmentBuild: true));
        Assert.NotNull(CompanionTls.Validate(config, developmentBuild: false));
    }

    [Fact]
    public void SelfSigned_IsRefusedInAReleaseBuild_AndAllowedInADevelopmentBuild()
    {
        var config = Config(("Companion:Tls:Mode", "SelfSigned"));
        Assert.Contains("development builds", CompanionTls.Validate(config, developmentBuild: false));
        Assert.Null(CompanionTls.Validate(config, developmentBuild: true));
    }

    [Fact]
    public void SelfSigned_CannotBeSwitchedOnAroundTheReleaseGuard_ByTheInsecureFlag()
    {
        var config = Config(("Companion:Tls:Mode", "SelfSigned"), ("Companion:Tls:AllowInsecureRemote", "true"), ("Companion:Host", "0.0.0.0"));
        Assert.NotNull(CompanionTls.Validate(config, developmentBuild: false));
    }

    [Fact]
    public void RealCertificateMode_NeedsAnExistingFile()
    {
        Assert.Contains("CertificatePath", CompanionTls.Validate(Config(("Companion:Tls:Mode", "Certificate")), false));
        Assert.Contains("does not exist", CompanionTls.Validate(Config(("Companion:Tls:Mode", "Certificate"), ("Companion:Tls:CertificatePath", Path.Combine(_dir, "nope.pfx"))), false));
        var pfx = Path.Combine(_dir, "ok.pfx");
        File.WriteAllBytes(pfx, [1]);
        Assert.Null(CompanionTls.Validate(Config(("Companion:Tls:Mode", "Certificate"), ("Companion:Tls:CertificatePath", pfx), ("Companion:Host", "0.0.0.0")), false));
        Assert.Contains("key file", CompanionTls.Validate(Config(("Companion:Tls:Mode", "Certificate"), ("Companion:Tls:CertificatePath", pfx), ("Companion:Tls:CertificateKeyPath", Path.Combine(_dir, "nope.key"))), false));
    }

    [Fact]
    public void AnUnknownModeIsAnError() =>
        Assert.Contains("Unknown", CompanionTls.Validate(Config(("Companion:Tls:Mode", "Maybe")), true));

    [Theory]
    [InlineData(null, "http")]
    [InlineData("Off", "http")]
    [InlineData("Certificate", "https")]
    [InlineData("SelfSigned", "https")]
    public void TheListenUrlFollowsTheMode(string? mode, string scheme) =>
        Assert.StartsWith($"{scheme}://localhost:5000", CompanionHostOptions.BuildListenUrl(Config(("Companion:Tls:Mode", mode))));

    // ── Certificates ─────────────────────────────────────────────────────────

    [Fact]
    public void ASelfSignedCertificate_IsForLocalhost_AndIsReusedUntilItExpires()
    {
        var path = Path.Combine(_dir, "dev.pfx");
        var first = CompanionTls.LoadOrCreateSelfSigned(path);

        Assert.True(first.HasPrivateKey);
        var names = first.Extensions.OfType<X509SubjectAlternativeNameExtension>().Single();
        Assert.Contains("localhost", names.EnumerateDnsNames());
        Assert.Contains(IPAddress.Loopback, names.EnumerateIPAddresses());
        Assert.True(first.NotAfter > DateTime.UtcNow.AddMonths(11));

        var again = CompanionTls.LoadOrCreateSelfSigned(path);
        Assert.Equal(first.Thumbprint, again.Thumbprint);
        if (!OperatingSystem.IsWindows())
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(path));
    }

    [Fact]
    public void AnUnreadableSelfSignedFile_IsReplaced()
    {
        var path = Path.Combine(_dir, "broken.pfx");
        File.WriteAllText(path, "not a certificate");
        Assert.True(CompanionTls.LoadOrCreateSelfSigned(path).HasPrivateKey);
    }

    [Fact]
    public void AConfiguredCertificate_IsLoadedFromAPfx()
    {
        var generated = CompanionTls.LoadOrCreateSelfSigned(Path.Combine(_dir, "src.pfx"));
        var pfx = Path.Combine(_dir, "real.pfx");
        File.WriteAllBytes(pfx, generated.Export(X509ContentType.Pfx, "secret"));

        var loaded = CompanionTls.LoadCertificate(
            Config(("Companion:Tls:Mode", "Certificate"), ("Companion:Tls:CertificatePath", pfx), ("Companion:Tls:CertificatePassword", "secret")), out var description);

        Assert.Equal(generated.Thumbprint, loaded.Thumbprint);
        Assert.Contains("real.pfx", description);
    }

    // ── A real HTTPS server ──────────────────────────────────────────────────

    [Fact]
    public async Task KestrelServesTheConfiguredCertificate_OverRealHttps()
    {
        var config = Config(("Companion:Tls:Mode", "SelfSigned"), ("Companion:Tls:SelfSignedPath", Path.Combine(_dir, "served.pfx")), ("Companion:Port", "0"));
        var certificate = CompanionTls.LoadCertificate(config, out _);

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("https://127.0.0.1:0");
        builder.WebHost.ConfigureKestrel(kestrel => kestrel.ConfigureHttpsDefaults(https => https.ServerCertificate = certificate));
        await using var app = builder.Build();
        app.MapGet("/ping", () => "pong");
        await app.StartAsync();
        var address = app.Urls.First();
        Assert.StartsWith("https://", address);

        X509Certificate2? seen = null;
        using var handler = new HttpClientHandler
        {
            ServerCertificateCustomValidationCallback = (_, cert, _, _) => { seen = new X509Certificate2(cert!); return true; },
        };
        using var client = new HttpClient(handler);
        Assert.Equal("pong", await client.GetStringAsync($"{address}/ping"));
        Assert.Equal(certificate.Thumbprint, seen!.Thumbprint);

        // Without trust, a normal client refuses the self-signed certificate — which is
        // exactly why the browser has to be told to accept it in development.
        using var strict = new HttpClient();
        await Assert.ThrowsAsync<HttpRequestException>(() => strict.GetStringAsync($"{address}/ping"));
        await app.StopAsync();
    }
}
