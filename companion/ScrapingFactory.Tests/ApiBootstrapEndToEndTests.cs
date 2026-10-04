using System.Diagnostics;
using System.Net;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #220: real end-to-end proof that the generated Api-mode script
// fetches a fresh bootstrap value (a bearer token) before the main
// requests, and splices it into headers/URLs/discovery requests — against a
// LocalTestServer whose data endpoints reject anything but the exact token
// its own token endpoint handed out, so a script that skipped or mangled
// the bootstrap could never produce a single row.
public class ApiBootstrapEndToEndTests
{
    private const string Token = "tok-8f3a1c";

    private static ScrapingPlan PlanWith(ApiConfig api, OutputFormat outputFormat = OutputFormat.Csv) => new()
    {
        Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
        OutputFormat = outputFormat,
        Engine = ScrapingEngine.Api,
    };

    private static string GenerateScript(ApiConfig api, OutputFormat outputFormat = OutputFormat.Csv) =>
        new PythonApiCodeGenerator().Generate(PlanWith(api, outputFormat));

    private static string ReadBody(HttpListenerRequest request)
    {
        using var reader = new StreamReader(request.InputStream, request.ContentEncoding);
        return reader.ReadToEnd();
    }

    // /auth/token hands out Token only for the expected credentials (JSON
    // or form-encoded, whichever `expectForm` says); every other path
    // requires "Authorization: Bearer <Token>" or a "sig=<Token>" query
    // parameter and otherwise answers 401.
    private static LocalTestServer TokenProtectedServer(bool expectForm = false) => new(request =>
    {
        var path = request.Url!.AbsolutePath;
        if (path == "/auth/token")
        {
            var body = ReadBody(request);
            var credentialsOk = expectForm
                ? request.ContentType?.StartsWith("application/x-www-form-urlencoded") == true &&
                  body.Contains("grant_type=client_credentials") && body.Contains("client_secret=s3cret")
                : request.ContentType?.StartsWith("application/json") == true &&
                  body.Contains("\"username\": \"alice\"") && body.Contains("\"password\": \"s3cret\"");
            return credentialsOk
                ? new LocalTestServerResponse($$"""{ "data": { "access_token": "{{Token}}" } }""", "application/json")
                : new LocalTestServerResponse("""{ "error": "bad credentials" }""", "application/json", HttpStatusCode.Unauthorized);
        }

        var authorized = request.Headers["Authorization"] == $"Bearer {Token}" || request.QueryString["sig"] == Token;
        if (!authorized)
            return new LocalTestServerResponse("""{ "error": "unauthorized" }""", "application/json", HttpStatusCode.Unauthorized);

        if (path == "/categories")
            return new LocalTestServerResponse("""{ "items": [ { "id": "milch" }, { "id": "missing" } ] }""", "application/json");
        if (path == "/items/missing")
            return new LocalTestServerResponse("{}", "application/json", HttpStatusCode.NotFound);

        var category = path.Split('/', StringSplitOptions.RemoveEmptyEntries).Last();
        return new LocalTestServerResponse(
            $$"""{ "data": { "categories": [ { "name": "{{category}}", "items": [ { "title": "{{category}}-1" }, { "title": "{{category}}-2" } ] } ] } }""",
            "application/json");
    });

    private static ApiBootstrap JsonBootstrap(string baseUrl, string passwordEnvVar = "SF_TEST_API_PASSWORD") => new()
    {
        Name = "token",
        Method = "POST",
        Url = $"{baseUrl}auth/token",
        BodyFields =
        [
            new ApiBootstrapBodyField { Name = "username", Value = "alice" },
            new ApiBootstrapBodyField { Name = "password", EnvironmentVariableName = passwordEnvVar },
        ],
        ValuePath = "data.access_token",
    };

    private static ApiConfig FlatApi(string baseUrl, ApiBootstrap bootstrap, string urlTemplate, List<ApiHeader>? headers = null, List<ApiParameter>? parameters = null) => new()
    {
        UrlTemplate = urlTemplate,
        ItemsPath = "data.categories[*].items",
        Fields = [new ApiField { Name = "Title", Path = "title" }],
        Parameters = parameters ?? [new ApiParameter { Name = "category", Source = new StaticListSource { Values = ["milch", "kaese"] } }],
        Headers = headers,
        Bootstrap = bootstrap,
    };

    private static readonly List<ApiHeader> BearerHeader = [new ApiHeader { Name = "Authorization", Template = "Bearer {token}" }];
    private static readonly Dictionary<string, string> PasswordEnv = new() { ["SF_TEST_API_PASSWORD"] = "s3cret" };

    [Fact]
    public async Task JsonBootstrap_TokenInTemplateHeader_AuthorizesMainRequests()
    {
        using var server = TokenProtectedServer();
        var api = FlatApi(server.BaseUrl, JsonBootstrap(server.BaseUrl), $"{server.BaseUrl}items/{{category}}", BearerHeader);
        var script = GenerateScript(api);

        Assert.DoesNotContain("s3cret", script);

        var result = await new PythonScriptVerifier().VerifyAsync(
            script, extraTimeout: TimeSpan.FromSeconds(30), extraEnvironmentVariables: PasswordEnv, includeOutputFile: true);

        Assert.True(result.Success, result.Error);
        Assert.Equal(4, result.RowCount);
        Assert.Contains("milch-1", result.OutputFileContent);
        Assert.Contains("kaese-2", result.OutputFileContent);
        Assert.DoesNotContain(Token, result.OutputFileContent);
    }

    [Fact]
    public async Task FormBootstrap_TokenInUrlTemplate_AuthorizesMainRequests()
    {
        using var server = TokenProtectedServer(expectForm: true);
        var bootstrap = new ApiBootstrap
        {
            Name = "token",
            Method = "POST",
            Url = $"{server.BaseUrl}auth/token",
            BodyEncoding = ApiBootstrapBodyEncoding.Form,
            BodyFields =
            [
                new ApiBootstrapBodyField { Name = "grant_type", Value = "client_credentials" },
                new ApiBootstrapBodyField { Name = "client_secret", EnvironmentVariableName = "SF_TEST_API_PASSWORD" },
            ],
            ValuePath = "data.access_token",
        };
        var api = FlatApi(server.BaseUrl, bootstrap, $"{server.BaseUrl}items/{{category}}?sig={{token}}");

        var result = await new PythonScriptVerifier().VerifyAsync(
            GenerateScript(api), extraTimeout: TimeSpan.FromSeconds(30), extraEnvironmentVariables: PasswordEnv, includeOutputFile: true);

        Assert.True(result.Success, result.Error);
        Assert.Equal(4, result.RowCount);
        Assert.DoesNotContain(Token, result.OutputFileContent);
    }

    // The discovery request reuses the main headers, so a token-protected
    // discovery endpoint works too; its "missing" category 404s on the main
    // endpoint, and the resulting "Skipped" line must not leak the token
    // that's part of the URL.
    [Fact]
    public async Task TreeShape_DiscoveryWithToken_ResolvesAndRedactsTokenInSkippedLine()
    {
        using var server = TokenProtectedServer();
        var api = new ApiConfig
        {
            UrlTemplate = $"{server.BaseUrl}items/{{category}}?sig={{token}}",
            Groups =
            [
                new ApiGroup
                {
                    Name = "Kategorie",
                    Path = "data.categories",
                    Children = [new ApiGroup { Name = "Artikel", Path = "items", Children = [new ApiField { Name = "Title", Path = "title" }] }],
                },
            ],
            Parameters =
            [
                new ApiParameter
                {
                    Name = "category",
                    Source = new DiscoverySource { UrlTemplate = $"{server.BaseUrl}categories", ItemsPath = "items", ValuePath = "id" },
                },
            ],
            Headers = BearerHeader,
            Bootstrap = JsonBootstrap(server.BaseUrl),
        };

        var (exitCode, stdout, stderr, output) = await RunScriptAsync(GenerateScript(api, OutputFormat.Xml), PasswordEnv, "output.xml");

        Assert.True(exitCode == 0, stderr);
        Assert.Contains("milch-2", output);
        Assert.Contains("Skipped (404 Not Found)", stdout);
        Assert.Contains("sig=***", stdout);
        Assert.DoesNotContain(Token, stdout + stderr + output);
    }

    [Fact]
    public async Task BadCredentials_FailWithDedicatedExitCodeAndCleanMessage()
    {
        using var server = TokenProtectedServer();
        var api = FlatApi(server.BaseUrl, JsonBootstrap(server.BaseUrl), $"{server.BaseUrl}items/{{category}}", BearerHeader);

        var (exitCode, _, stderr, _) = await RunScriptAsync(
            GenerateScript(api), new Dictionary<string, string> { ["SF_TEST_API_PASSWORD"] = "wrong" }, "output.csv");

        Assert.Equal(6, exitCode);
        Assert.Contains("ERROR: bootstrap request to", stderr);
        Assert.Contains("HTTP 401", stderr);
        Assert.DoesNotContain("Traceback", stderr);
    }

    [Fact]
    public async Task MissingValuePath_FailsWithDedicatedExitCode()
    {
        using var server = TokenProtectedServer();
        var bootstrap = JsonBootstrap(server.BaseUrl);
        var api = FlatApi(server.BaseUrl, new ApiBootstrap
        {
            Name = bootstrap.Name, Method = bootstrap.Method, Url = bootstrap.Url, BodyFields = bootstrap.BodyFields,
            ValuePath = "data.nope",
        }, $"{server.BaseUrl}items/{{category}}", BearerHeader);

        var (exitCode, _, stderr, _) = await RunScriptAsync(GenerateScript(api), PasswordEnv, "output.csv");

        Assert.Equal(6, exitCode);
        Assert.Contains("no value found at JSON path 'data.nope'", stderr);
    }

    [Fact]
    public async Task MissingCredentialEnvVar_FailsWithMissingEnvVarExitCode()
    {
        using var server = TokenProtectedServer();
        var api = FlatApi(server.BaseUrl, JsonBootstrap(server.BaseUrl, "SF_TEST_API_PASSWORD_UNSET_220"), $"{server.BaseUrl}items/{{category}}", BearerHeader);

        var (exitCode, _, stderr, _) = await RunScriptAsync(GenerateScript(api), new Dictionary<string, string>(), "output.csv");

        Assert.Equal(78, exitCode);
        Assert.Contains("SF_TEST_API_PASSWORD_UNSET_220", stderr);
        Assert.DoesNotContain("Traceback", stderr);
    }

    private static async Task<(int ExitCode, string Stdout, string Stderr, string Output)> RunScriptAsync(
        string script, IReadOnlyDictionary<string, string> env, string outputFileName)
    {
        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-bootstrap-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            foreach (var candidate in new[] { "python3", "python" })
            {
                var psi = new ProcessStartInfo
                {
                    FileName = candidate,
                    WorkingDirectory = workDir,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                psi.ArgumentList.Add(scriptPath);
                foreach (var (name, value) in env)
                    psi.Environment[name] = value;
                try
                {
                    using var process = new Process { StartInfo = psi };
                    process.Start();
                    var stderrTask = process.StandardError.ReadToEndAsync();
                    var stdoutTask = process.StandardOutput.ReadToEndAsync();
                    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                    await process.WaitForExitAsync(cts.Token);
                    var outputPath = Path.Combine(workDir, outputFileName);
                    var output = File.Exists(outputPath) ? await File.ReadAllTextAsync(outputPath) : "";
                    return (process.ExitCode, await stdoutTask, await stderrTask, output);
                }
                catch (System.ComponentModel.Win32Exception)
                {
                    // executable not found — try the next candidate
                }
            }
            throw new InvalidOperationException("No python3/python executable found.");
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }
}
