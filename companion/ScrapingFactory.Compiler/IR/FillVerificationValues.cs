namespace ScrapingFactory.Compiler.IR;

// Bridges ScrapingConfig.VerificationValues (arbitrary, extension-supplied
// dict) and the FillAction.EnvironmentVariableName values a given
// BrowserActions list actually declares — /generate's defense against
// injecting an unrelated/stray env var into the verification subprocess.
public static class FillVerificationValues
{
    // Issue #220: apiConfig's bootstrap request is the Api-mode analog of a
    // FillAction login flow, so the env vars its own credential body
    // fields/headers declare are just as legitimate a target for a one-time
    // test value — see BootstrapEnvironmentVariableNames.
    // Issue #226: the env vars of DOM-mode request headers (ScrapingConfig.
    // Headers) are legitimate targets too — a "protected" page's API key or
    // cookie can then be verified without being set in the OS environment.
    public static Dictionary<string, string> Filter(
        List<BrowserAction>? browserActions, Dictionary<string, string>? verificationValues, ApiConfig? apiConfig = null,
        List<ApiHeader>? requestHeaders = null)
    {
        if (verificationValues is null || verificationValues.Count == 0)
            return [];

        var declaredNames = (browserActions ?? [])
            .OfType<FillAction>()
            .Select(a => a.EnvironmentVariableName)
            .Concat(BootstrapEnvironmentVariableNames(apiConfig))
            .Concat((requestHeaders ?? []).Select(header => header.EnvironmentVariableName).Where(name => !string.IsNullOrEmpty(name)).Select(name => name!))
            .ToHashSet();

        return verificationValues
            .Where(kv => declaredNames.Contains(kv.Key) && !string.IsNullOrEmpty(kv.Value))
            .ToDictionary(kv => kv.Key, kv => kv.Value);
    }

    private static IEnumerable<string> BootstrapEnvironmentVariableNames(ApiConfig? apiConfig)
    {
        if (apiConfig?.Bootstrap is not { } bootstrap)
            return [];
        return (bootstrap.BodyFields ?? []).Select(field => field.EnvironmentVariableName)
            .Concat((bootstrap.Headers ?? []).Select(header => header.EnvironmentVariableName))
            .Where(name => !string.IsNullOrEmpty(name))
            .Select(name => name!);
    }
}
