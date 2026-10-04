using System.Net;
using System.Net.Sockets;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Follow-up to Issue #220 (reported against the api-token-bootstrap fixture
// with authentication left unconfigured): a failed API-mode request used to
// surface through /generate as a raw requests.HTTPError traceback wrapped in
// "Script exited with an error (exit code 1)". These tests pin the error
// text the user actually sees now — PythonScriptVerifier's own result, the
// same string /generate returns — for every failure class a real API can
// produce: missing/wrong authentication, a server error, an unreachable
// host, a non-JSON response, and a failing discovery request.
public class ApiRequestErrorEndToEndTests
{
    private static ScrapingPlan PlanWith(ApiConfig api) => new()
    {
        Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
        OutputFormat = OutputFormat.Csv,
        Engine = ScrapingEngine.Api,
    };

    private static ApiConfig Api(string urlTemplate, List<ApiParameter>? parameters = null, List<ApiHeader>? headers = null, ApiBootstrap? bootstrap = null) => new()
    {
        UrlTemplate = urlTemplate,
        ItemsPath = "items",
        Fields = [new ApiField { Name = "Title", Path = "title" }],
        Parameters = parameters ?? [],
        Headers = headers,
        Bootstrap = bootstrap,
    };

    private static Task<Compiler.Backends.ScriptVerificationResult> Verify(ApiConfig api) =>
        new PythonScriptVerifier().VerifyAsync(new PythonApiCodeGenerator().Generate(PlanWith(api)), extraTimeout: TimeSpan.FromSeconds(30));

    private static void AssertCleanError(Compiler.Backends.ScriptVerificationResult result)
    {
        Assert.False(result.Success);
        Assert.DoesNotContain("Traceback", result.Error);
        Assert.DoesNotContain("exited with an error", result.Error);
        Assert.DoesNotContain("ERROR: ", result.Error);
    }

    private static LocalTestServer StatusServer(HttpStatusCode status, string body = "{}", string contentType = "application/json") =>
        new(_ => new LocalTestServerResponse(body, contentType, status));

    [Fact]
    public async Task Unauthorized_WithoutAuthConfigured_ExplainsWhatToConfigure()
    {
        using var server = StatusServer(HttpStatusCode.Unauthorized);

        var result = await Verify(Api($"{server.BaseUrl}api/items?category=x"));

        AssertCleanError(result);
        Assert.StartsWith($"Request to {server.BaseUrl}api/items?category=x failed: HTTP 401 (Unauthorized).", result.Error);
        Assert.Contains("requires authentication", result.Error);
        Assert.Contains("auth bootstrap", result.Error);
    }

    [Fact]
    public async Task Forbidden_IsReportedAsAuthenticationProblemToo()
    {
        using var server = StatusServer(HttpStatusCode.Forbidden);

        var result = await Verify(Api($"{server.BaseUrl}api/items"));

        AssertCleanError(result);
        Assert.Contains("HTTP 403 (Forbidden)", result.Error);
        Assert.Contains("requires authentication", result.Error);
    }

    // A bootstrap that works but whose token never reaches the main request
    // (here: no header template configured) — the hint must point at that,
    // and the token itself must not appear in the message.
    [Fact]
    public async Task Unauthorized_WithBootstrapConfigured_PointsAtTokenUsageAndNeverLeaksIt()
    {
        const string token = "tok-secret-4711";
        using var server = new LocalTestServer(request => request.Url!.AbsolutePath == "/auth/token"
            ? new LocalTestServerResponse($$"""{ "access_token": "{{token}}" }""", "application/json")
            : new LocalTestServerResponse("{}", "application/json", HttpStatusCode.Unauthorized));

        var result = await Verify(Api($"{server.BaseUrl}api/items", bootstrap: new ApiBootstrap
        {
            Name = "token", Method = "GET", Url = $"{server.BaseUrl}auth/token", ValuePath = "access_token",
        }));

        AssertCleanError(result);
        Assert.Contains("even though a fresh bootstrap value was fetched", result.Error);
        Assert.Contains("Authorization: Bearer {token}", result.Error);
        Assert.DoesNotContain(token, result.Error);
    }

    [Fact]
    public async Task BootstrapRejected_ShowsOnlyTheCleanBootstrapMessage()
    {
        using var server = StatusServer(HttpStatusCode.Unauthorized);

        var result = await Verify(Api($"{server.BaseUrl}api/items", bootstrap: new ApiBootstrap
        {
            Name = "token", Method = "GET", Url = $"{server.BaseUrl}auth/token", ValuePath = "access_token",
        }));

        AssertCleanError(result);
        Assert.Equal($"bootstrap request to {server.BaseUrl}auth/token failed: HTTP 401.", result.Error);
    }

    [Fact]
    public async Task ServerError_SaysItIsUsuallyTemporary()
    {
        using var server = StatusServer(HttpStatusCode.InternalServerError);

        var result = await Verify(Api($"{server.BaseUrl}api/items"));

        AssertCleanError(result);
        Assert.Contains("HTTP 500. The API's server reported an error", result.Error);
    }

    [Fact]
    public async Task UnreachableHost_SaysTheApiCouldNotBeReached()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop(); // nothing listens here any more

        var result = await Verify(Api($"http://127.0.0.1:{port}/api/items"));

        AssertCleanError(result);
        Assert.Contains("could not reach the API (ConnectionError)", result.Error);
    }

    [Fact]
    public async Task NonJsonResponse_SaysSoInsteadOfAJsonDecodeTraceback()
    {
        using var server = StatusServer(HttpStatusCode.OK, "<html>login</html>", "text/html; charset=utf-8");

        var result = await Verify(Api($"{server.BaseUrl}api/items"));

        AssertCleanError(result);
        Assert.Contains("the response is not JSON (Content-Type: text/html; charset=utf-8)", result.Error);
    }

    [Fact]
    public async Task FailingDiscoveryRequest_IsNamedAsSuch()
    {
        using var server = StatusServer(HttpStatusCode.Forbidden);

        var result = await Verify(Api($"{server.BaseUrl}api/items/{{category}}", parameters:
        [
            new ApiParameter
            {
                Name = "category",
                Source = new DiscoverySource { UrlTemplate = $"{server.BaseUrl}api/categories", ItemsPath = "items", ValuePath = "id" },
            },
        ]));

        AssertCleanError(result);
        Assert.StartsWith($"Discovery request to {server.BaseUrl}api/categories failed: HTTP 403 (Forbidden).", result.Error);
    }
}
