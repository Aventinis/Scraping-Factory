using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #388: the companion's rule for an environment-variable name against test-vectors/env-var-name.json, the table
// the extension's ENV_VAR_NAME_PATTERN (popup/env-var.test.js) also runs.
public class EnvVarNameVectorTests
{
    private const string VectorFile = "env-var-name.json";

    public static IEnumerable<object[]> Cases() => TestVectors.Names(VectorFile);

    [Theory]
    [MemberData(nameof(Cases))]
    public void Validate_ProxyEnvironmentVariableName_MatchesTheSharedVectors(string name)
    {
        var testCase = TestVectors.Case(VectorFile, name);
        var result = ScrapingPlanValidator.Validate(new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = ["https://example.com/"] }, new ExtractStep { Name = "F", Selector = ".v" }],
            Proxy = new ProxyConfig { EnvironmentVariableName = testCase.GetProperty("value").GetString()! },
        });
        Assert.Equal(testCase.GetProperty("valid").GetBoolean(), result.Success);
    }
}
