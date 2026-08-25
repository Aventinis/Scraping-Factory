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

        // Container-Mode: Groups replaces Fields wholesale, and forces Xml
        // regardless of what the wire payload set OutputFormat to — the
        // extension doesn't need to know this any more than it needs to set
        // Engine=Browser for a login flow (see ScrapingConfig.Groups).
        if (config.Groups is { Count: > 0 } groups)
        {
            steps.Add(new ExtractGroupStep { Roots = groups });
            return new ScrapingPlan { Steps = steps, OutputFormat = OutputFormat.Xml, Engine = config.Engine };
        }

        steps.AddRange(config.Fields.Select(field =>
            (ScrapingStep)new ExtractStep { Name = field.Name, Selector = field.Selector, Attribute = field.Attribute }));

        return new ScrapingPlan { Steps = steps, OutputFormat = config.OutputFormat, Engine = config.Engine };
    }
}
