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
        steps.AddRange(config.Fields.Select(field =>
            (ScrapingStep)new ExtractStep { Name = field.Name, Selector = field.Selector, Attribute = field.Attribute }));

        return new ScrapingPlan { Steps = steps, OutputFormat = config.OutputFormat };
    }
}
