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

        var navigate = plan.Steps.OfType<NavigateStep>().Single();

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
        var changeDetection = PythonChangeDetectionLiteral.BuildContext(plan.ChangeDetection);
        var proxy = PythonProxyLiteral.BuildContext(plan.Proxy);
        var hardening = PythonHardeningLiteral.BuildContext(plan.Hardening);
        var pagination = PythonPaginationLiteral.BuildContext(plan.Pagination);
        var externalConfig = PythonExternalConfigLiteral.BuildContext(plan.ExternalConfig);

        // Issue #182: Blocks replaces every other extraction shape wholesale
        // — see PythonCodeGenerator's equivalent branch for the reasoning.
        // Login/wait steps (if any) still run first, shared across every
        // block, exactly like Container-Mode's own case below.
        var blockStep = plan.Steps.OfType<ExtractionBlockStep>().SingleOrDefault();
        if (blockStep is not null)
        {
            var blockChangeDetectionAny = blockStep.Blocks.Any(b => b.ChangeDetection is not null);
            var blocksShellTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_scraper_blocks.py.j2");
            return blocksShellTemplate.Render(new
            {
                urls = navigate.Urls,
                blocks_literal = PythonExtractionBlockLiteral.Render(blockStep.Blocks),
                blocks_meta = blockStep.Blocks.Select(b => new { name = b.Name, shape = b.Groups is not null ? "group" : "flat" }).ToList(),
                any_flat = blockStep.Blocks.Any(b => b.Groups is null),
                any_group = blockStep.Blocks.Any(b => b.Groups is not null),
                any_csv = blockStep.Blocks.Any(b => b.Groups is null && b.OutputFormat != OutputFormat.Json),
                any_json_output = blockStep.Blocks.Any(b => b.OutputFormat == OutputFormat.Json),
                hardening_any = blockStep.Blocks.Any(b => b.Hardening is { Count: > 0 }),
                hardening_has_baseline_any = blockStep.Blocks.Any(b => b.Hardening?.Any(check => check is BaselineCheck) == true),
                change_detection_any = blockChangeDetectionAny,
                actions,
                navigate_action = navigateFragment,
                login_actions = loginActionsIndented,
                has_login_actions = loginActionsOnly.Length > 0,
                persistent_session_enabled = plan.PersistentSession,
                // Blocks-specific: needsOsImport was computed from
                // plan.ChangeDetection (always null for a Blocks plan — see
                // ScrapingPlanBuilder), so a per-block ChangeDetection needs
                // folding in here instead.
                needs_os_import = needsOsImport || blockChangeDetectionAny,
                needs_exit_helper = needsExitHelper,
                script_filename = plan.ScriptFileName,
                proxy,
                pagination,
            });
        }

        // Container-Mode: login/wait steps (if any) still run first — only
        // the extraction phase after them differs (group tree → XML instead
        // of flat fields → CSV). See ExtractGroupStep and
        // PythonCodeGenerator's equivalent branch.
        var groupStep = plan.Steps.OfType<ExtractGroupStep>().SingleOrDefault();
        if (groupStep is not null)
        {
            var groupsLiteral = PythonGroupTreeLiteral.Render(groupStep.Roots, indent: 0);
            var rootNames = groupStep.Roots.Select(root => root.Name).ToList();
            var groupedShellTemplate = EmbeddedScribanTemplate.Load(assembly, "playwright_scraper_grouped.py.j2");
            return groupedShellTemplate.Render(new
            {
                urls = navigate.Urls,
                groups_literal = groupsLiteral,
                root_names = rootNames,
                actions,
                navigate_action = navigateFragment,
                login_actions = loginActionsIndented,
                has_login_actions = loginActionsOnly.Length > 0,
                persistent_session_enabled = plan.PersistentSession,
                needs_os_import = needsOsImport,
                needs_exit_helper = needsExitHelper,
                script_filename = plan.ScriptFileName,
                output_filename = plan.OutputFileBaseName,
                output_is_json = plan.OutputFormat == OutputFormat.Json,
                change_detection = changeDetection,
                proxy,
                hardening,
                pagination,
                external_config = externalConfig,
            });
        }

        var fields = plan.Steps.OfType<ExtractStep>()
            .Select(step => new
            {
                name = step.Name, selector = step.Selector, attribute = step.Attribute, frame_path = step.FramePath,
                transforms_literal = PythonFieldTransformLiteral.Render(step.Transforms),
            })
            .ToList();

        return shellTemplate.Render(new
        {
            urls = navigate.Urls, fields, actions,
            navigate_action = navigateFragment,
            login_actions = loginActionsIndented,
            has_login_actions = loginActionsOnly.Length > 0,
            persistent_session_enabled = plan.PersistentSession,
            needs_os_import = needsOsImport,
            needs_exit_helper = needsExitHelper,
            script_filename = plan.ScriptFileName, output_filename = plan.OutputFileBaseName,
            output_is_json = plan.OutputFormat == OutputFormat.Json,
            change_detection = changeDetection,
            proxy,
            hardening,
            pagination,
            external_config = externalConfig,
        });
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
