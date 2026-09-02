using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class FillVerificationValuesTests
{
    [Fact]
    public void Filter_KeepsValuesMatchingADeclaredFillActionEnvVarName()
    {
        var actions = new List<BrowserAction>
        {
            new FillAction { Selector = "#username", EnvironmentVariableName = "SF_USER" },
            new FillAction { Selector = "#password", EnvironmentVariableName = "SF_PASS" },
        };
        var values = new Dictionary<string, string> { ["SF_USER"] = "alice", ["SF_PASS"] = "s3cret" };

        var result = FillVerificationValues.Filter(actions, values);

        Assert.Equal(new Dictionary<string, string> { ["SF_USER"] = "alice", ["SF_PASS"] = "s3cret" }, result);
    }

    [Fact]
    public void Filter_DropsKeysWithNoMatchingFillAction()
    {
        var actions = new List<BrowserAction> { new FillAction { Selector = "#username", EnvironmentVariableName = "SF_USER" } };
        var values = new Dictionary<string, string> { ["SF_USER"] = "alice", ["SF_UNRELATED"] = "whatever" };

        var result = FillVerificationValues.Filter(actions, values);

        Assert.Equal(new Dictionary<string, string> { ["SF_USER"] = "alice" }, result);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Filter_DropsEmptyOrNullValues(string? value)
    {
        var actions = new List<BrowserAction> { new FillAction { Selector = "#username", EnvironmentVariableName = "SF_USER" } };
        var values = new Dictionary<string, string> { ["SF_USER"] = value! };

        var result = FillVerificationValues.Filter(actions, values);

        Assert.Empty(result);
    }

    [Fact]
    public void Filter_ReturnsEmptyForNullBrowserActionsOrVerificationValues()
    {
        Assert.Empty(FillVerificationValues.Filter(null, new Dictionary<string, string> { ["SF_USER"] = "alice" }));
        Assert.Empty(FillVerificationValues.Filter(
            [new FillAction { Selector = "#username", EnvironmentVariableName = "SF_USER" }], null));
    }

    [Fact]
    public void Filter_IgnoresNonFillActionsWhenCollectingDeclaredNames()
    {
        var actions = new List<BrowserAction>
        {
            new ClickAction { Selector = "#submit" },
            new WaitForAction { Selector = "#dashboard" },
        };
        var values = new Dictionary<string, string> { ["SF_USER"] = "alice" };

        var result = FillVerificationValues.Filter(actions, values);

        Assert.Empty(result);
    }
}
