using System.Reflection;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Generates the Browser-engine (Playwright) script. Navigate/WaitFor/Fill/Click/Scroll steps are rendered from one
// small fragment template each, in order, since each is one concrete action at a fixed point in the flow; Extract
// steps are aggregated into dicts like the static generator.
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

        // The URL comes from scrape()'s `url` parameter (the action sequence runs once per start URL). With retries on,
        // only the navigation is wrapped in _send_with_retry, never a half-run login sequence.
        var navigateFragment = navigateTemplate.Render().TrimEnd();

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
                ClickStep s => clickTemplate.Render(new { step = new { selector = s.Selector, frame_path = s.FramePath, target = s.Target.ToString().ToLowerInvariant(), wait_after_ms = s.WaitAfterMs } }).TrimEnd(),
                ScrollStep s => scrollTemplate.Render(new
                {
                    step = new
                    {
                        container_selector = s.ContainerSelector,
                        load_more_button_selector = s.LoadMoreButtonSelector,
                        max_iterations = s.MaxIterations,
                        wait_after_ms = s.WaitAfterMs,
                        scroll_step_px = s.ScrollStepPx,
                        frame_path = s.FramePath,
                    },
                }).TrimEnd(),
                _ => null,
            })
            .Where(line => line is not null)
            .Select(line => line!)
            .ToList();

        var actions = string.Join("\n", actionLines);

        // The same fragments minus Navigate (always element 0), indented one level deeper, for the "if not _session_exists:"
        // block of a persistent session. `actions` itself is unchanged.
        var loginActionsOnly = string.Join("\n", actionLines.Skip(1));
        var loginActionsIndented = IndentLines(loginActionsOnly, "    ");

        // Change detection, proxy and the persistent session also need `import os`.
        var needsOsImport = plan.Steps.OfType<FillStep>().Any() || plan.ChangeDetection is not null || plan.Proxy is not null || plan.PersistentSession
            || PythonRequestHeadersLiteral.UsesEnvironmentVariables(plan.Headers);
        // A FillStep credential or the proxy list must be set at run time; both use the shared _require_env /
        // EXIT_MISSING_ENV_VAR helper instead of a raw KeyError.
        var needsExitHelper = plan.Steps.OfType<FillStep>().Any() || plan.Proxy is not null
            || PythonRequestHeadersLiteral.UsesEnvironmentVariables(plan.Headers);
        // The shared options are derived from `plan` inside PythonScrapingContextBuilder.

        // What every shape branch adds: the login / browser-action sequence, which the Static engine has no equivalent of.
        // needsOsImportOverride lets the Blocks branch fold in its per-block change detection.
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

        // Blocks: login steps still run first, shared across blocks.
        var blockStep = plan.Steps.OfType<ExtractionBlockStep>().SingleOrDefault();
        if (blockStep is not null)
        {
            // needsOsImport was computed from plan.ChangeDetection, which is null for a Blocks plan; fold in the blocks' own.
            var blockChangeDetectionAny = blockStep.Blocks.Any(b => b.ChangeDetection is not null);
            var blocksContext = WithBrowserActionKeys(
                PythonScrapingContextBuilder.BuildBlocksContext(plan, blockStep), needsOsImport || blockChangeDetectionAny);
            var blocksShellTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_scraper_blocks.py.j2");
            return blocksShellTemplate.Render(blocksContext);
        }

        // Container mode: login steps still run first; only the extraction phase differs (see PythonCodeGenerator).
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

    // Re-indents every non-empty line of a rendered action block (each fragment hardcodes its own indentation).
    private static string IndentLines(string block, string prefix) =>
        block.Length == 0
            ? block
            : string.Join("\n", block.Split('\n').Select(line => line.Length == 0 ? line : prefix + line));
}
