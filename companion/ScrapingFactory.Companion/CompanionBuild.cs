namespace ScrapingFactory.Companion;

// Issue #352: development conveniences that would be a security risk in the
// hands of an ordinary user — self-signed TLS certificates, plain HTTP on a
// non-local address — exist only in a Debug build (what `dotnet run` from a
// checkout produces). The release bundles are published in Release
// configuration, so there the configuration cannot switch them on.
public static class CompanionBuild
{
#if DEBUG
    public const bool IsDevelopment = true;
#else
    public const bool IsDevelopment = false;
#endif
}
