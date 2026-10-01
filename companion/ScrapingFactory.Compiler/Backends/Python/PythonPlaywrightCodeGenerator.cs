using System.Reflection;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Generates a Playwright-based script for the Browser engine (dynamically
// rendered pages, and simple login flows). Navigate/WaitFor/Fill/Click
// steps become inline actions rendered from their own small fragment
// templates, one per step, in order — that's the per-step-type template
// composition the static generator's monolithic template doesn't need.
// Extract steps still end up aggregated into SELECTORS/ATTRIBUTES dicts
// like the static generator, since extraction itself has no per-step
// control flow (unlike the other step types, which each correspond to one
// specific action at one specific point in the flow).
public sealed class PythonPlaywrightCodeGenerator : ICodeGenerator
{
    public string LanguageId => "python";
    public ScrapingEngine Engine => ScrapingEngine.Browser;

    public string Generate(ScrapingPlan plan)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var navigateTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_navigate_step.py.j2");
        var waitTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_wait_step.py.j2");
        var fillTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_fill_step.py.j2");
        var clickTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_click_step.py.j2");
        var scrollTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_scroll_step.py.j2");
        var shellTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_scraper.py.j2");

        // Issue #83: the target URL is no longer baked in as a literal here
        // — it comes from scrape()'s own `url` parameter at runtime, since
        // the same action sequence now runs once per start URL. See
        // playwright_navigate_step.py.j2.
        var navigateFragment = navigateTemplate.Render(new { }).TrimEnd();

        var actionLines = plan.Steps
            .Select(step => step switch
            {
                NavigateStep => navigateFragment,
                WaitForStep s => waitTemplate.Render(new
                {
                    step = new { selector = s.Selector, timeout_ms = s.TimeoutMs, frame_path = s.FramePath },
                }).TrimEnd(),
                FillStep s => fillTemplate.Render(new
                {
                    step = new { selector = s.Selector, env_var = s.EnvironmentVariableName, frame_path = s.FramePath },
                }).TrimEnd(),
                ClickStep s => clickTemplate.Render(new { step = new { selector = s.Selector, frame_path = s.FramePath } }).TrimEnd(),
                ScrollStep s => scrollTemplate.Render(new
                {
                    step = new
                    {
                        container_selector = s.ContainerSelector,
                        load_more_button_selector = s.LoadMoreButtonSelector,
                        max_iterations = s.MaxIterations,
                        wait_after_ms = s.WaitAfterMs,
                        frame_path = s.FramePath,
                    },
                }).TrimEnd(),
                _ => null,
            })
            .Where(line => line is not null)
            .Select(line => line!)
            .ToList();

        var actions = string.Join("\n", actionLines);

        // Issue #175: the same fragments minus Navigate (always element 0 —
        // ScrapingPlanBuilder always adds exactly one NavigateStep first),
        // re-indented one level deeper — used only when PersistentSession is
        // enabled, to nest inside the generated "if not _session_exists:"
        // block that skips the login-only actions on a run reusing an
        // already-saved session. `actions` itself is untouched, so a
        // disabled config's output stays byte-for-byte what it was before
        // this existed.
        var loginActionsOnly = string.Join("\n", actionLines.Skip(1));
        var loginActionsIndented = IndentLines(loginActionsOnly, "    ");

        // Issue #87/#88: change detection and proxy support also read env
        // vars at runtime (SMTP/webhook credentials, proxy URL list), same
        // reason FillStep already needs `import os`. Issue #175: persistent
        // session checks os.path.exists(SESSION_STATE_PATH).
        var needsOsImport = plan.Steps.OfType<FillStep>().Any() || plan.ChangeDetection is not null || plan.Proxy is not null || plan.PersistentSession;
        // A FillStep's credential or Proxy's URL list must come from an
        // environment variable that's actually set at runtime — both share
        // the `_require_env`/`EXIT_MISSING_ENV_VAR` helper (see the shell
        // templates) instead of a raw, unhandled KeyError. Change detection
        // isn't included: its own env-var reads are unaffected by this.
        var needsExitHelper = plan.Steps.OfType<FillStep>().Any() || plan.Proxy is not null;
        // change_detection/proxy/hardening/pagination/external_config are no
        // longer computed here — PythonScrapingContextBuilder's own methods
        // below each derive them straight from `plan` internally, exactly
        // like PythonCodeGenerator's (Static engine) equivalent branches do.

        // The one piece every shape branch below adds on top of whichever
        // PythonScrapingContextBuilder context it starts from — the Browser
        // engine's own login/browser-action sequence, which the Static
        // engine has no equivalent of at all. `needsOsImportOverride` lets
        // the Blocks branch fold in its own per-block ChangeDetection check
        // (see its own call site) without this helper needing to know why.
        Dictionary<string, object?> WithBrowserActionKeys(Dictionary<string, object?> context, bool needsOsImportOverride)
        {
            context["actions"] = actions;
            context["navigate_action"] = navigateFragment;
            context["login_actions"] = loginActionsIndented;
            context["has_login_actions"] = loginActionsOnly.Length > 0;
            context["persistent_session_enabled"] = plan.PersistentSession;
            context["needs_os_import"] = needsOsImportOverride;
            context["needs_exit_helper"] = needsExitHelper;
            return context;
        }

        // Issue #182: Blocks replaces every other extraction shape wholesale
        // — see PythonCodeGenerator's equivalent branch for the reasoning.
        // Login/wait steps (if any) still run first, shared across every
        // block, exactly like Container-Mode's own case below.
        var blockStep = plan.Steps.OfType<ExtractionBlockStep>().SingleOrDefault();
        if (blockStep is not null)
        {
            // Blocks-specific: needsOsImport was computed from
            // plan.ChangeDetection (always null for a Blocks plan — see
            // ScrapingPlanBuilder), so a per-block ChangeDetection needs
            // folding in here instead.
            var blockChangeDetectionAny = blockStep.Blocks.Any(b => b.ChangeDetection is not null);
            var blocksContext = WithBrowserActionKeys(
                PythonScrapingContextBuilder.BuildBlocksContext(plan, blockStep), needsOsImport || blockChangeDetectionAny);
            var blocksShellTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_scraper_blocks.py.j2");
            return blocksShellTemplate.Render(blocksContext);
        }

        // Container-Mode: login/wait steps (if any) still run first — only
        // the extraction phase after them differs (group tree → XML instead
        // of flat fields → CSV). See ExtractGroupStep and
        // PythonCodeGenerator's equivalent branch.
        var groupStep = plan.Steps.OfType<ExtractGroupStep>().SingleOrDefault();
        if (groupStep is not null)
        {
            var groupContext = WithBrowserActionKeys(
                PythonScrapingContextBuilder.BuildGroupModeContext(plan, groupStep), needsOsImport);
            var groupedShellTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_scraper_grouped.py.j2");
            return groupedShellTemplate.Render(groupContext);
        }

        var flatContext = WithBrowserActionKeys(PythonScrapingContextBuilder.BuildFlatModeContext(plan), needsOsImport);
        return shellTemplate.Render(flatContext);
    }

    // Issue #175: re-indents every non-empty line of a rendered action
    // block by `prefix` — needed because each playwright_*_step.py.j2
    // fragment already hardcodes its own indentation for the "one level
    // under sync_playwright()'s with-block" case; nesting the same fragment
    // one level deeper inside "if not _session_exists:" requires shifting it
    // over without re-rendering it differently.
    private static string IndentLines(string block, string prefix) =>
        block.Length == 0
            ? block
            : string.Join("\n", block.Split('\n').Select(line => line.Length == 0 ? line : prefix + line));
}
