namespace ScrapingFactory.Compiler.IR;

// Fast, in-process structural checks on a ScrapingPlan, run before codegen
// and (much more expensively) real script execution — rejects configs that
// are wrong no matter how the generated script behaves (malformed URL,
// duplicate/empty field names) without paying for a subprocess spawn and a
// real network request.
//
// Deliberately does NOT validate CSS selector syntax or compatibility with
// BeautifulSoup/soupsieve — that's a known, accepted limitation of the
// chosen approach (see CLAUDE.md "Selektor-Kompatibilität") and is only
// ever proven by PythonScriptVerifier actually running the script.
public static class ScrapingPlanValidator
{
    public static PlanValidationResult Validate(ScrapingPlan plan)
    {
        if (plan.Steps.Count == 0 || plan.Steps[0] is not NavigateStep navigate)
            return Invalid("Plan muss mit einem NavigateStep beginnen.");

        if (plan.Steps.Skip(1).Any(step => step is NavigateStep))
            return Invalid("Plan darf nur einen NavigateStep enthalten.");

        if (!Uri.TryCreate(navigate.Url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            return Invalid($"Ungültige URL '{navigate.Url}': muss eine absolute http(s)-URL sein.");
        }

        var extractSteps = plan.Steps.OfType<ExtractStep>().ToList();
        if (extractSteps.Count == 0)
            return Invalid("Plan muss mindestens einen ExtractStep enthalten.");

        foreach (var step in extractSteps)
        {
            if (string.IsNullOrWhiteSpace(step.Name))
                return Invalid("Feldname darf nicht leer sein.");
            if (string.IsNullOrWhiteSpace(step.Selector))
                return Invalid($"Selector für Feld '{step.Name}' darf nicht leer sein.");
        }

        var duplicateNames = extractSteps
            .GroupBy(step => step.Name)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();
        if (duplicateNames.Count > 0)
            return Invalid($"Doppelte Feldnamen: {string.Join(", ", duplicateNames)}.");

        return new PlanValidationResult { Success = true };
    }

    private static PlanValidationResult Invalid(string error) => new() { Success = false, Error = error };
}
