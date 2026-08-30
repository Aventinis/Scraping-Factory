namespace ScrapingFactory.Compiler.IR;

// Translates the wire-facing ScrapingConfig into the canonical Steps-based
// ScrapingPlan: today's Fields become one NavigateStep followed by one
// ExtractStep per field. This is the seam where future wire-level features
// would plug in without changing ICodeGenerator/IScriptVerifier, which only
// ever see a ScrapingPlan.
public static class ScrapingPlanBuilder
{
    public static ScrapingPlan Build(ScrapingConfig config)
    {
        var steps = new List<ScrapingStep> { new NavigateStep { Url = config.Url } };

        // Browser actions run before extraction regardless of mode (Fields/
        // Groups/Api) — same "runs first, extraction phase after differs"
        // shape as a login flow already had via WaitFor/Fill/Click before
        // BrowserActions gave them a wire path.
        if (config.BrowserActions is { Count: > 0 } actions)
            steps.AddRange(actions.Select(ToStep));

        // Sanitized once here, regardless of mode — see FileNameSanitizer for
        // why this happens server-side instead of trusting the wire payload.
        var scriptFileName = FileNameSanitizer.SanitizeBaseName(config.ScriptFileName, "scraper");
        var outputFileBaseName = FileNameSanitizer.SanitizeBaseName(config.OutputFileName, "output");

        // Container-Mode: Groups replaces Fields wholesale, and forces Xml
        // regardless of what the wire payload set OutputFormat to — the
        // extension doesn't need to know this any more than it needs to set
        // Engine=Browser for a login flow (see ScrapingConfig.Groups).
        if (config.Groups is { Count: > 0 } groups)
        {
            steps.Add(new ExtractGroupStep { Roots = groups });
            return new ScrapingPlan
            {
                Steps = steps, OutputFormat = OutputFormat.Xml, Engine = config.Engine,
                ScriptFileName = scriptFileName, OutputFileBaseName = outputFileBaseName,
            };
        }

        // API-Mode: Api replaces Fields/Groups wholesale, and forces Csv +
        // Engine.Api regardless of what the wire payload set — same
        // "the extension doesn't need to set this itself" pattern as
        // Container-Mode forcing Xml above.
        if (config.Api is { } api)
        {
            steps.Add(new ApiCallStep { Config = api });
            return new ScrapingPlan
            {
                Steps = steps, OutputFormat = OutputFormat.Csv, Engine = ScrapingEngine.Api,
                ScriptFileName = scriptFileName, OutputFileBaseName = outputFileBaseName,
            };
        }

        steps.AddRange(config.Fields.Select(field =>
            (ScrapingStep)new ExtractStep
            {
                Name = field.Name, Selector = field.Selector, Attribute = field.Attribute, FramePath = field.FramePath,
            }));

        return new ScrapingPlan
        {
            Steps = steps, OutputFormat = config.OutputFormat, Engine = config.Engine,
            ScriptFileName = scriptFileName, OutputFileBaseName = outputFileBaseName,
        };
    }

    private static ScrapingStep ToStep(BrowserAction action) => action switch
    {
        WaitForAction a => new WaitForStep { Selector = a.Selector, TimeoutMs = a.TimeoutMs },
        FillAction a => new FillStep { Selector = a.Selector, EnvironmentVariableName = a.EnvironmentVariableName },
        ClickAction a => new ClickStep { Selector = a.Selector },
        ScrollAction a => new ScrollStep
        {
            ContainerSelector = a.ContainerSelector,
            LoadMoreButtonSelector = a.LoadMoreButtonSelector,
            MaxIterations = a.MaxIterations,
            WaitAfterMs = a.WaitAfterMs,
        },
        _ => throw new InvalidOperationException($"Unbekannter BrowserAction-Typ: {action.GetType().Name}"),
    };
}
