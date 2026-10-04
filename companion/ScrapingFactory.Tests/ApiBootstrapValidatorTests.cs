using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #220: structural validation of ApiConfig.Bootstrap and the
// ApiHeader.Template variant it enables.
public class ApiBootstrapValidatorTests
{
    private static ApiBootstrap ValidBootstrap(string name = "token") => new()
    {
        Name = name,
        Method = "POST",
        Url = "https://example.com/auth/token",
        BodyFields =
        [
            new ApiBootstrapBodyField { Name = "username", Value = "alice" },
            new ApiBootstrapBodyField { Name = "password", EnvironmentVariableName = "API_PASSWORD" },
        ],
        ValuePath = "access_token",
    };

    private static ApiConfig Api(
        ApiBootstrap? bootstrap, string urlTemplate = "https://example.com/api/items?category={category}",
        List<ApiHeader>? headers = null, List<ApiParameter>? parameters = null, ApiBodyNode? body = null, string method = "GET") => new()
    {
        Method = method,
        UrlTemplate = urlTemplate,
        ItemsPath = "data.items",
        Fields = [new ApiField { Name = "Titel", Path = "title" }],
        Parameters = parameters ?? [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["a"] } }],
        Headers = headers,
        Body = body,
        Bootstrap = bootstrap,
    };

    private static PlanValidationResult Validate(ApiConfig api) => ScrapingPlanValidator.Validate(new ScrapingPlan
    {
        Engine = ScrapingEngine.Api,
        Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
    });

    private static readonly List<ApiHeader> BearerTemplateHeader =
        [new ApiHeader { Name = "Authorization", Template = "Bearer {token}" }];

    [Fact]
    public void ValidBootstrapWithTemplateHeader_Succeeds()
    {
        var result = Validate(Api(ValidBootstrap(), headers: BearerTemplateHeader));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void BootstrapPlaceholderInUrlTemplate_IsNotAnUnknownParameter()
    {
        var result = Validate(Api(ValidBootstrap(), urlTemplate: "https://example.com/api/items?category={category}&sig={token}"));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void BootstrapPlaceholderInUrlTemplate_WithoutBootstrap_Fails()
    {
        var result = Validate(Api(null, urlTemplate: "https://example.com/api/items?category={category}&sig={token}"));
        Assert.False(result.Success);
        Assert.Contains("unknown parameters: token", result.Error);
    }

    [Fact]
    public void BootstrapValueAsBodyVariable_Succeeds()
    {
        var body = new ApiBodyObject { Properties = new() { ["auth"] = new ApiBodyVariable { ParameterName = "token" } } };
        var result = Validate(Api(ValidBootstrap(), body: body, method: "POST"));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void BootstrapPlaceholderInDiscoveryTemplate_Succeeds()
    {
        var parameters = new List<ApiParameter>
        {
            new()
            {
                Name = "category",
                Source = new DiscoverySource { UrlTemplate = "https://example.com/api/categories?sig={token}", ItemsPath = "items", ValuePath = "id" },
            },
        };
        var result = Validate(Api(ValidBootstrap(), parameters: parameters));
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void TemplateHeaderWithoutBootstrap_Fails()
    {
        var result = Validate(Api(null, headers: BearerTemplateHeader));
        Assert.False(result.Success);
        Assert.Contains("no bootstrap request is configured", result.Error);
    }

    [Fact]
    public void TemplateHeaderNotReferencingBootstrapValue_Fails()
    {
        var headers = new List<ApiHeader> { new() { Name = "Authorization", Template = "Bearer {other}" } };
        var result = Validate(Api(ValidBootstrap(), headers: headers));
        Assert.False(result.Success);
        Assert.Contains("must reference the bootstrap value", result.Error);
    }

    [Fact]
    public void HeaderWithBothValueAndTemplate_Fails()
    {
        var headers = new List<ApiHeader> { new() { Name = "Authorization", Value = "x", Template = "Bearer {token}" } };
        var result = Validate(Api(ValidBootstrap(), headers: headers));
        Assert.False(result.Success);
        Assert.Contains("exactly one of Value/EnvironmentVariableName/Template", result.Error);
    }

    [Fact]
    public void BootstrapNameCollidingWithParameter_Fails()
    {
        var result = Validate(Api(ValidBootstrap("category")));
        Assert.False(result.Success);
        Assert.Contains("collides with a parameter name", result.Error);
    }

    [Theory]
    [InlineData("")]
    [InlineData("my-token")]
    [InlineData("1token")]
    public void InvalidBootstrapName_Fails(string name)
    {
        var result = Validate(Api(ValidBootstrap(name)));
        Assert.False(result.Success);
        Assert.Contains("Bootstrap value", result.Error, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("not a url")]
    [InlineData("ftp://example.com/token")]
    [InlineData("https://example.com/token?x={category}")]
    public void InvalidBootstrapUrl_Fails(string url)
    {
        var bootstrap = ValidBootstrap();
        var result = Validate(Api(new ApiBootstrap { Name = "token", Method = "POST", Url = url, BodyFields = bootstrap.BodyFields, ValuePath = "access_token" }));
        Assert.False(result.Success);
        Assert.Contains("ootstrap request URL", result.Error);
    }

    [Fact]
    public void BootstrapBodyFieldsWithGet_Fails()
    {
        var bootstrap = ValidBootstrap();
        var result = Validate(Api(new ApiBootstrap { Name = "token", Method = "GET", Url = bootstrap.Url, BodyFields = bootstrap.BodyFields, ValuePath = "access_token" }));
        Assert.False(result.Success);
        Assert.Contains("require method 'POST'", result.Error);
    }

    [Fact]
    public void BootstrapWithBlankValuePath_Fails()
    {
        var result = Validate(Api(new ApiBootstrap { Name = "token", Url = "https://example.com/token", ValuePath = " " }));
        Assert.False(result.Success);
        Assert.Contains("ValuePath", result.Error);
    }

    [Fact]
    public void BootstrapBodyFieldWithInvalidEnvVarName_Fails()
    {
        var result = Validate(Api(new ApiBootstrap
        {
            Name = "token", Method = "POST", Url = "https://example.com/token", ValuePath = "t",
            BodyFields = [new ApiBootstrapBodyField { Name = "password", EnvironmentVariableName = "BAD-NAME" }],
        }));
        Assert.False(result.Success);
        Assert.Contains("Invalid environment variable name 'BAD-NAME'", result.Error);
    }

    [Fact]
    public void BootstrapBodyFieldWithNeitherValueNorEnvVar_Fails()
    {
        var result = Validate(Api(new ApiBootstrap
        {
            Name = "token", Method = "POST", Url = "https://example.com/token", ValuePath = "t",
            BodyFields = [new ApiBootstrapBodyField { Name = "password" }],
        }));
        Assert.False(result.Success);
        Assert.Contains("exactly one of Value/EnvironmentVariableName", result.Error);
    }

    [Fact]
    public void BootstrapHeaderUsingTemplate_Fails()
    {
        var result = Validate(Api(new ApiBootstrap
        {
            Name = "token", Url = "https://example.com/token", ValuePath = "t",
            Headers = [new ApiHeader { Name = "Authorization", Template = "Bearer {token}" }],
        }));
        Assert.False(result.Success);
        Assert.Contains("cannot use a template", result.Error);
    }
}
