namespace ScrapingFactory.Compiler.IR;

// Bridges ScrapingConfig.VerificationValues (arbitrary, extension-supplied
// dict) and the FillAction.EnvironmentVariableName values a given
// BrowserActions list actually declares — /generate's defense against
// injecting an unrelated/stray env var into the verification subprocess.
public static class FillVerificationValues
{
    public static Dictionary<string, string> Filter(
        List<BrowserAction>? browserActions, Dictionary<string, string>? verificationValues)
    {
        if (verificationValues is null || verificationValues.Count == 0)
            return [];

        var declaredNames = (browserActions ?? [])
            .OfType<FillAction>()
            .Select(a => a.EnvironmentVariableName)
            .ToHashSet();

        return verificationValues
            .Where(kv => declaredNames.Contains(kv.Key) && !string.IsNullOrEmpty(kv.Value))
            .ToDictionary(kv => kv.Key, kv => kv.Value);
    }
}
