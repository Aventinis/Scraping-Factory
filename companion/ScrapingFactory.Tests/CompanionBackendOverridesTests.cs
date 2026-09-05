using Microsoft.Extensions.Configuration;
using ScrapingFactory.Companion;
using Xunit;

namespace ScrapingFactory.Tests;

public class CompanionBackendOverridesTests
{
    private static IConfiguration BuildConfig(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    [Fact]
    public void Build_NoConfig_ReturnsEmptyOverrides()
    {
        var overrides = CompanionBackendOverrides.Build(BuildConfig([]));
        Assert.Empty(overrides);
    }

    [Fact]
    public void Build_PythonExecutableConfigured_MapsToPythonExecutableKey()
    {
        var config = BuildConfig(new Dictionary<string, string?> { ["Companion:PythonExecutable"] = "python3.12" });
        var overrides = CompanionBackendOverrides.Build(config);
        Assert.Equal("python3.12", overrides["pythonExecutable"]);
    }

    [Fact]
    public void Build_BlankPythonExecutable_IsIgnored()
    {
        var config = BuildConfig(new Dictionary<string, string?> { ["Companion:PythonExecutable"] = "   " });
        var overrides = CompanionBackendOverrides.Build(config);
        Assert.False(overrides.ContainsKey("pythonExecutable"));
    }

    [Fact]
    public void Build_VerifierTimeoutSecondsConfigured_MapsToTimeoutKeyAsTimeSpan()
    {
        var config = BuildConfig(new Dictionary<string, string?> { ["Companion:VerifierTimeoutSeconds"] = "90" });
        var overrides = CompanionBackendOverrides.Build(config);
        Assert.Equal(TimeSpan.FromSeconds(90), overrides["timeout"]);
    }

    [Fact]
    public void Build_ZeroOrNegativeVerifierTimeoutSeconds_IsIgnored()
    {
        var config = BuildConfig(new Dictionary<string, string?> { ["Companion:VerifierTimeoutSeconds"] = "0" });
        var overrides = CompanionBackendOverrides.Build(config);
        Assert.False(overrides.ContainsKey("timeout"));
    }
}
