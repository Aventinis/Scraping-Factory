using Microsoft.Extensions.Configuration;

namespace ScrapingFactory.Companion;

// PythonExecutable/VerifierTimeoutSeconds are the same kind of
// hosting-machine-specific value as CompanionHostOptions' own Host/Port
// (Companion:PythonExecutable lets a machine with a non-standard Python
// install point at the right binary; Companion:VerifierTimeoutSeconds raises
// the trial-run timeout on a slower machine) — this maps them onto
// LanguageModuleRegistry's generic ctorOverrides dictionary, which then
// routes them into PythonScriptVerifier's own optional
// (pythonExecutable, timeout) constructor parameters by name, without this
// project needing a direct reference to that Python-specific type.
public static class CompanionBackendOverrides
{
    public static Dictionary<string, object?> Build(IConfiguration configuration)
    {
        var overrides = new Dictionary<string, object?>();

        var pythonExecutable = configuration["Companion:PythonExecutable"];
        if (!string.IsNullOrWhiteSpace(pythonExecutable))
            overrides["pythonExecutable"] = pythonExecutable;

        var verifierTimeoutSeconds = configuration.GetValue<int?>("Companion:VerifierTimeoutSeconds");
        if (verifierTimeoutSeconds is > 0)
            overrides["timeout"] = TimeSpan.FromSeconds(verifierTimeoutSeconds.Value);

        return overrides;
    }
}
