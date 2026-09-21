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
        // Issue #83: AdditionalUrls entries are trimmed and blank ones
        // dropped — a pasted list's stray empty line is a formatting
        // artifact, not a URL the caller actually meant to add, unlike a
        // genuinely malformed non-blank entry, which still surfaces as a
        // real validation error in ScrapingPlanValidator.
        var urls = new List<string> { config.Url };
        if (config.AdditionalUrls is { Count: > 0 } additionalUrls)
        {
            urls.AddRange(additionalUrls.Select(u => u.Trim()).Where(u => u.Length > 0));
        }

        var steps = new List<ScrapingStep> { new NavigateStep { Urls = urls } };

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
        // Engine=Browser for a login flow (see ScrapingConfig.Groups) —
        // unless the caller explicitly asked for Json (Issue #86), which
        // fits a tree just as well as Xml does and is honored instead.
        if (config.Groups is { Count: > 0 } groups)
        {
            var groupsOutputFormat = config.OutputFormat == OutputFormat.Json ? OutputFormat.Json : OutputFormat.Xml;
            steps.Add(new ExtractGroupStep { Roots = groups });
            return new ScrapingPlan
            {
                Steps = steps, OutputFormat = groupsOutputFormat, Engine = config.Engine,
                ScriptFileName = scriptFileName, OutputFileBaseName = outputFileBaseName,
                ChangeDetection = config.ChangeDetection, Proxy = config.Proxy, Hardening = config.Hardening,
                Pagination = config.Pagination, PersistentSession = config.PersistentSession ?? false,
                ExternalConfig = config.ExternalConfig ?? false,
            };
        }

        // Issue #182: Blocks replaces Fields/Groups/Api wholesale with N
        // independent extraction phases sharing this one NavigateStep/set of
        // browser actions — each block resolves its own shape/output
        // filename/format exactly like the single-shape branches below do
        // for the whole plan, just once per block instead of once overall.
        // ChangeDetection/Hardening are intentionally NOT carried onto the
        // returned ScrapingPlan here (unlike every other branch) — they live
        // per-block on PlanExtractionBlock instead, since Program.cs's
        // /generate handler already rejects them being set on the outer
        // config when Blocks is set. ExternalConfig is rejected outright
        // together with Blocks (see ScrapingConfig.Blocks), so it's likewise
        // left at its default (false) here rather than carried through.
        if (config.Blocks is { Count: > 0 } blocksConfig)
        {
            var planBlocks = blocksConfig.Select((block, i) =>
            {
                var resolvedName = string.IsNullOrWhiteSpace(block.Name) ? $"block_{i + 1}" : block.Name.Trim();
                var outputFileBaseName = FileNameSanitizer.SanitizeBaseName(
                    string.IsNullOrWhiteSpace(block.OutputFileName) ? resolvedName : block.OutputFileName,
                    $"output_{i + 1}");
                var hasGroups = block.Groups is { Count: > 0 };
                var outputFormat = block.OutputFormat ?? (hasGroups ? OutputFormat.Xml : OutputFormat.Csv);

                return new PlanExtractionBlock
                {
                    Name = resolvedName,
                    Fields = hasGroups ? null : block.Fields?.Select(field => new ExtractStep
                    {
                        Name = field.Name, Selector = field.Selector, Attribute = field.Attribute,
                        FramePath = field.FramePath, Transforms = field.Transforms,
                    }).ToList(),
                    Groups = hasGroups ? block.Groups : null,
                    OutputFormat = outputFormat,
                    OutputFileBaseName = outputFileBaseName,
                    ChangeDetection = block.ChangeDetection,
                    Hardening = block.Hardening,
                };
            }).ToList();

            steps.Add(new ExtractionBlockStep { Blocks = planBlocks });
            return new ScrapingPlan
            {
                Steps = steps, Engine = config.Engine,
                ScriptFileName = scriptFileName,
                Proxy = config.Proxy, Pagination = config.Pagination,
                PersistentSession = config.PersistentSession ?? false,
            };
        }

        // API-Mode: Api replaces Fields/Groups wholesale, and forces
        // Engine.Api regardless of what the wire payload set — same
        // "the extension doesn't need to set this itself" pattern as
        // Container-Mode forcing Xml above. OutputFormat itself depends on
        // which of Api's two response shapes is set (Issue #54): the flat
        // ItemsPath/Fields shape still forces Csv exactly as before, but
        // the tree shape (Groups) forces Xml instead — tree data doesn't
        // fit CSV's column model, the same reason Container-Mode's own
        // tree forces Xml above. Either forced default yields to an
        // explicit Json request (Issue #86), same as Container-Mode.
        if (config.Api is { } api)
        {
            var isJson = config.OutputFormat == OutputFormat.Json;
            var apiOutputFormat = api.Groups is { Count: > 0 }
                ? (isJson ? OutputFormat.Json : OutputFormat.Xml)
                : (isJson ? OutputFormat.Json : OutputFormat.Csv);
            steps.Add(new ApiCallStep { Config = api });
            return new ScrapingPlan
            {
                Steps = steps, OutputFormat = apiOutputFormat, Engine = ScrapingEngine.Api,
                ScriptFileName = scriptFileName, OutputFileBaseName = outputFileBaseName,
                ChangeDetection = config.ChangeDetection, Proxy = config.Proxy, Hardening = config.Hardening,
                PersistentSession = config.PersistentSession ?? false,
                ExternalConfig = config.ExternalConfig ?? false,
            };
        }

        steps.AddRange(config.Fields.Select(field =>
            (ScrapingStep)new ExtractStep
            {
                Name = field.Name, Selector = field.Selector, Attribute = field.Attribute, FramePath = field.FramePath,
                Transforms = field.Transforms,
            }));

        return new ScrapingPlan
        {
            Steps = steps, OutputFormat = config.OutputFormat, Engine = config.Engine,
            ScriptFileName = scriptFileName, OutputFileBaseName = outputFileBaseName,
            ChangeDetection = config.ChangeDetection, Proxy = config.Proxy, Hardening = config.Hardening,
            Pagination = config.Pagination, PersistentSession = config.PersistentSession ?? false,
            ExternalConfig = config.ExternalConfig ?? false,
        };
    }

    private static ScrapingStep ToStep(BrowserAction action) => action switch
    {
        WaitForAction a => new WaitForStep { Selector = a.Selector, TimeoutMs = a.TimeoutMs, FramePath = a.FramePath },
        FillAction a => new FillStep
        {
            Selector = a.Selector, EnvironmentVariableName = a.EnvironmentVariableName, FramePath = a.FramePath,
        },
        ClickAction a => new ClickStep { Selector = a.Selector, FramePath = a.FramePath },
        ScrollAction a => new ScrollStep
        {
            ContainerSelector = a.ContainerSelector,
            LoadMoreButtonSelector = a.LoadMoreButtonSelector,
            MaxIterations = a.MaxIterations,
            WaitAfterMs = a.WaitAfterMs,
            FramePath = a.FramePath,
        },
        _ => throw new InvalidOperationException($"Unknown BrowserAction type: {action.GetType().Name}"),
    };
}
