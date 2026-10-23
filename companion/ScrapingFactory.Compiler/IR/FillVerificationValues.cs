namespace ScrapingFactory.Compiler.IR;

// Keeps only the extension-supplied VerificationValues whose env var some config part actually declares (FillAction,
// the API bootstrap's credentials, request headers), so a stray variable is never injected into the trial run.
public static class FillVerificationValues
{
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
