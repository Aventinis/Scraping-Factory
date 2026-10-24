using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Tests;

// A one-call API-mode plan around an ApiConfig and the script the Python API code generator makes of it. The end-to-end and
// verifier tests that only vary the ApiConfig share these through `using static`.
internal static class ApiScriptPlans
{
    public static ScrapingPlan PlanWith(ApiConfig api, OutputFormat outputFormat = OutputFormat.Csv) => new()
    {
        Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
        OutputFormat = outputFormat,
        Engine = ScrapingEngine.Api,
    };

    public static string GenerateScript(ApiConfig api, OutputFormat outputFormat = OutputFormat.Csv) =>
        new PythonApiCodeGenerator().Generate(PlanWith(api, outputFormat));
}
