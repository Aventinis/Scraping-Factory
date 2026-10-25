namespace ScrapingFactory.Compiler.IR;

// WaitFor/Fill/Click/Scroll only mean something in a real browser.
public static partial class ScrapingPlanValidator
{
    private static string? ValidateBrowserSteps(ScrapingPlan plan)
    {
        // The Static engine's code generator ignores these steps; silently dropping them would be confusing.
        var hasBrowserOnlySteps = plan.Steps.Any(step => step is WaitForStep or FillStep or ClickStep or ScrollStep);
        if (plan.Engine != ScrapingEngine.Browser && hasBrowserOnlySteps)
            return "WaitForStep/FillStep/ClickStep/ScrollStep require Engine 'Browser'.";

        // One kind after the other (not in plan order), so the first error reported is stable.
        return plan.Steps.OfType<WaitForStep>().Select(step => ValidateWaitFor(step, plan.Engine)).FirstOrDefault(error => error is not null)
            ?? plan.Steps.OfType<FillStep>().Select(step => ValidateFill(step, plan.Engine)).FirstOrDefault(error => error is not null)
            ?? plan.Steps.OfType<ClickStep>().Select(step => ValidateClick(step, plan.Engine)).FirstOrDefault(error => error is not null)
            ?? plan.Steps.OfType<ScrollStep>().Select(step => ValidateScroll(step, plan.Engine)).FirstOrDefault(error => error is not null);
    }

    private static string? ValidateWaitFor(WaitForStep step, ScrapingEngine engine)
    {
        if (string.IsNullOrWhiteSpace(step.Selector))
            return "Selector of a WaitForStep must not be empty.";
        var selectorError = SelectorTextFilter.Validate(step.Selector, "Selector of a WaitForStep");
        if (selectorError is not null)
            return selectorError;
        if (step.TimeoutMs <= 0)
            return "Timeout of a WaitForStep must be positive.";
        return ValidateFramePath(step.FramePath, "WaitForStep", engine);
    }

    private static string? ValidateFill(FillStep step, ScrapingEngine engine)
    {
        if (string.IsNullOrWhiteSpace(step.Selector))
            return "Selector of a FillStep must not be empty.";
        var selectorError = SelectorTextFilter.Validate(step.Selector, "Selector of a FillStep");
        if (selectorError is not null)
            return selectorError;
        if (!EnvironmentVariableNamePattern.IsMatch(step.EnvironmentVariableName))
            return $"Invalid environment variable name '{step.EnvironmentVariableName}' in FillStep.";
        return ValidateFramePath(step.FramePath, "FillStep", engine);
    }

    private static string? ValidateClick(ClickStep step, ScrapingEngine engine)
    {
        if (string.IsNullOrWhiteSpace(step.Selector))
            return "Selector of a ClickStep must not be empty.";
        var selectorError = SelectorTextFilter.Validate(step.Selector, "Selector of a ClickStep");
        if (selectorError is not null)
            return selectorError;
        var frameError = ValidateFramePath(step.FramePath, "ClickStep", engine);
        if (frameError is not null)
            return frameError;
        return step.WaitAfterMs < 0 ? "WaitAfterMs of a ClickStep must not be negative." : null;
    }

    private static string? ValidateScroll(ScrollStep step, ScrapingEngine engine)
    {
        if (step.ContainerSelector is not null && string.IsNullOrWhiteSpace(step.ContainerSelector))
            return "ContainerSelector of a ScrollStep must not be empty when set.";
        if (step.LoadMoreButtonSelector is not null && string.IsNullOrWhiteSpace(step.LoadMoreButtonSelector))
            return "LoadMoreButtonSelector of a ScrollStep must not be empty when set.";
        var selectorError = SelectorTextFilter.Validate(step.ContainerSelector, "ContainerSelector of a ScrollStep")
            ?? SelectorTextFilter.Validate(step.LoadMoreButtonSelector, "LoadMoreButtonSelector of a ScrollStep");
        if (selectorError is not null)
            return selectorError;
        if (step.MaxIterations <= 0)
            return "MaxIterations of a ScrollStep must be positive.";
        if (step.WaitAfterMs < 0)
            return "WaitAfterMs of a ScrollStep must not be negative.";
        if (step.ScrollStepPx is <= 0)
            return "ScrollStepPx of a ScrollStep must be positive when set.";
        return ValidateFramePath(step.FramePath, "ScrollStep", engine);
    }
}
