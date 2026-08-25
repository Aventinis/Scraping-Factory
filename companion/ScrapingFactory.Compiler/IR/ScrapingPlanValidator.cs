using System.Text.RegularExpressions;

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

        // WaitFor/Fill/Click all need a real browser to mean anything — the
        // Static engine's codegen simply doesn't look at them, so silently
        // generating a script that just drops them would be confusing.
        var browserOnlySteps = plan.Steps.Where(step => step is WaitForStep or FillStep or ClickStep).ToList();
        if (plan.Engine != ScrapingEngine.Browser && browserOnlySteps.Count > 0)
            return Invalid("WaitForStep/FillStep/ClickStep erfordern Engine 'Browser'.");

        foreach (var waitStep in plan.Steps.OfType<WaitForStep>())
        {
            if (string.IsNullOrWhiteSpace(waitStep.Selector))
                return Invalid("Selector eines WaitForStep darf nicht leer sein.");
            if (waitStep.TimeoutMs <= 0)
                return Invalid("Timeout eines WaitForStep muss positiv sein.");
        }

        foreach (var fillStep in plan.Steps.OfType<FillStep>())
        {
            if (string.IsNullOrWhiteSpace(fillStep.Selector))
                return Invalid("Selector eines FillStep darf nicht leer sein.");
            if (!EnvironmentVariableNamePattern.IsMatch(fillStep.EnvironmentVariableName))
                return Invalid($"Ungültiger Umgebungsvariablen-Name '{fillStep.EnvironmentVariableName}' in FillStep.");
        }

        foreach (var clickStep in plan.Steps.OfType<ClickStep>())
        {
            if (string.IsNullOrWhiteSpace(clickStep.Selector))
                return Invalid("Selector eines ClickStep darf nicht leer sein.");
        }

        // Container-Mode replaces the flat ExtractStep list wholesale — see
        // ScrapingPlanBuilder. Engine-independent, so deliberately not part
        // of browserOnlySteps above.
        var extractGroupStep = plan.Steps.OfType<ExtractGroupStep>().SingleOrDefault();
        if (extractGroupStep is not null)
        {
            if (extractGroupStep.Roots.Count == 0)
                return Invalid("ExtractGroupStep muss mindestens eine Gruppe enthalten.");

            var groupError = ValidateContainerNodes(extractGroupStep.Roots);
            return groupError is null ? new PlanValidationResult { Success = true } : Invalid(groupError);
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

    private static readonly Regex EnvironmentVariableNamePattern = new("^[A-Za-z_][A-Za-z0-9_]*$");

    private static PlanValidationResult Invalid(string error) => new() { Success = false, Error = error };

    // Deliberately doesn't check whether Name is a valid XML tag name, or
    // whether a non-repeating GroupNode's selector could ever match more
    // than once — same laissez-faire as CSS selector syntax elsewhere in
    // this validator (see class doc comment): a bad tag name surfaces as a
    // real Python exception via PythonScriptVerifier, not here.
    private static string? ValidateContainerNodes(IEnumerable<ContainerNode> nodes)
    {
        foreach (var node in nodes)
        {
            if (string.IsNullOrWhiteSpace(node.Name))
                return "Name eines Container-Knotens darf nicht leer sein.";

            switch (node)
            {
                case GroupNode group:
                    if (string.IsNullOrWhiteSpace(group.Selector))
                        return $"Selector der Gruppe '{group.Name}' darf nicht leer sein.";
                    var childError = ValidateContainerNodes(group.Children);
                    if (childError is not null)
                        return childError;
                    break;

                case DataFieldNode field:
                    if (string.IsNullOrWhiteSpace(field.Selector))
                        return $"Selector des Datenfelds '{field.Name}' darf nicht leer sein.";
                    if (field.Mode == ExtractMode.Attribute && string.IsNullOrWhiteSpace(field.Attribute))
                        return $"Datenfeld '{field.Name}' mit Modus 'Attribute' braucht ein Attribut.";
                    break;
            }
        }
        return null;
    }
}
