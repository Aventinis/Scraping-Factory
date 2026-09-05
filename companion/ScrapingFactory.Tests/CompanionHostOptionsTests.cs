using Microsoft.Extensions.Configuration;
using ScrapingFactory.Companion;
using Xunit;

namespace ScrapingFactory.Tests;

public class CompanionHostOptionsTests
{
    private static IConfiguration BuildConfig(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    [Fact]
    public void BuildListenUrl_NoConfig_DefaultsToLocalhost5000()
    {
        var config = BuildConfig([]);
        Assert.Equal("http://localhost:5000", CompanionHostOptions.BuildListenUrl(config));
    }

    [Fact]
    public void BuildListenUrl_CustomHostAndPort_UsesConfiguredValues()
    {
        var config = BuildConfig(new Dictionary<string, string?>
        {
            ["Companion:Host"] = "0.0.0.0",
            ["Companion:Port"] = "8080",
        });
        Assert.Equal("http://0.0.0.0:8080", CompanionHostOptions.BuildListenUrl(config));
    }

    [Fact]
    public void BuildListenUrl_BlankHost_FallsBackToDefault()
    {
        var config = BuildConfig(new Dictionary<string, string?> { ["Companion:Host"] = "   " });
        Assert.Equal("http://localhost:5000", CompanionHostOptions.BuildListenUrl(config));
    }

    [Fact]
    public void BuildListenUrl_PortOnly_KeepsDefaultHost()
    {
        var config = BuildConfig(new Dictionary<string, string?> { ["Companion:Port"] = "5050" });
        Assert.Equal("http://localhost:5050", CompanionHostOptions.BuildListenUrl(config));
    }
}
