namespace ScrapingFactory.Compiler.IR;

public abstract class ScrapingStep
{
}

// Issue #83: carries every start URL the same extraction config runs
// against (the wire-format's Url plus any AdditionalUrls, combined in
// ScrapingPlanBuilder) — always at least one entry. Only PythonCodeGenerator/
// PythonPlaywrightCodeGenerator read this; PythonApiCodeGenerator has its own
// per-request URL templating (ApiConfig.UrlTemplate) and ignores it entirely.
public sealed class NavigateStep : ScrapingStep
{
    public required List<string> Urls { get; init; }
}

public sealed class ExtractStep : ScrapingStep
{
    public required string Name { get; init; }
    public required string Selector { get; init; }

    // null = Textinhalt; "href", "src" usw. für Attribut-Extraktion
    public string? Attribute { get; init; }

    // Browser-engine only (Issue #42): an ordered list of CSS selectors
    // identifying each iframe from the top document down to the frame
    // containing Selector, e.g. ["iframe#outer", "iframe.inner"] — null (the
    // default) means Selector is evaluated against the top-level document,
    // today's only behavior. Shadow DOM needs no such field: Playwright's own
    // selector engine pierces open shadow roots automatically for a plain
    // CSS selector passed to query_selector/query_selector_all/locator, so
    // Selector alone is already enough there.
    public List<string>? FramePath { get; init; }

    // Issue #84: an optional, ordered post-processing chain (trim/regex
    // extract/replace/to-number) applied to the raw extracted value before
    // it's written to the output row — see IR/FieldTransform.cs. Null/empty
    // = today's behavior, the raw value unchanged.
    public List<FieldTransform>? Transforms { get; init; }
}

// Browser-engine only: waits for a selector to appear before continuing,
// for content that's inserted client-side after the initial page load.
public sealed class WaitForStep : ScrapingStep
{
    public required string Selector { get; init; }
    public int TimeoutMs { get; init; } = 5000;

    // See ExtractStep.FramePath (Issue #42, Phase 4) — same "absolute path
    // from the top document, resolved fresh regardless of any other step's
    // own FramePath" semantic.
    public List<string>? FramePath { get; init; }
}

// Browser-engine only: fills a form field, e.g. a login form's username or
// password input. The value is never embedded literally in the generated
// script — always sourced from an environment variable at runtime, so
// credentials don't end up in plain text in a saved/shared script.
public sealed class FillStep : ScrapingStep
{
    public required string Selector { get; init; }
    public required string EnvironmentVariableName { get; init; }

    // See ExtractStep.FramePath (Issue #42, Phase 4) — e.g. a login form
    // embedded via an SSO iframe widget.
    public List<string>? FramePath { get; init; }
}

// Browser-engine only: clicks an element, e.g. a login form's submit
// button. Deliberately just a click — anything that needs to happen after
// (e.g. waiting for the resulting page) is a separate WaitForStep.
public sealed class ClickStep : ScrapingStep
{
    public required string Selector { get; init; }

    // See ExtractStep.FramePath (Issue #42, Phase 4) — e.g. a cookie-consent
    // button that lives inside an iframe.
    public List<string>? FramePath { get; init; }
}

// Browser-engine only: repeatedly scrolls (the whole page, or a specific
// container) and/or clicks a "load more" button, to surface content that
// only appears after infinite-scroll/lazy-loading has fired — for content
// already present in the initial DOM, WaitForStep is enough. Always capped
// by MaxIterations; the earlier stop signal depends on whether
// LoadMoreButtonSelector is set: with a button, its own disappearance is the
// signal (more reliable than page height — newly loaded content can still
// fit within the viewport without ever growing scrollHeight); without one,
// the page/container no longer growing across two consecutive rounds is the
// only signal available. See playwright_scroll_step.py.j2.
public sealed class ScrollStep : ScrapingStep
{
    public string? ContainerSelector { get; init; }
    public string? LoadMoreButtonSelector { get; init; }
    public int MaxIterations { get; init; } = 10;
    public int WaitAfterMs { get; init; } = 1000;

    // See ExtractStep.FramePath (Issue #42, Phase 4) — applies to both
    // ContainerSelector and LoadMoreButtonSelector, since a single ScrollStep
    // already targets one specific area of one specific page/frame.
    public List<string>? FramePath { get; init; }
}

// Container-Mode: replaces the flat list of ExtractSteps entirely when the
// wire-format config carries Groups instead of Fields. Engine-independent —
// unlike WaitFor/Fill/Click it works identically with Static and Browser
// codegen, only the DOM-access calls in the generated extract_group()
// differ. See ContainerNode.
public sealed class ExtractGroupStep : ScrapingStep
{
    public required List<GroupNode> Roots { get; init; }
}

// API-Mode (Issue #53): replaces the flat list of ExtractSteps entirely when
// the wire-format config carries Api instead of Fields/Groups — a single
// step because, unlike NavigateStep + ExtractStep, fetching and parsing a
// JSON API response isn't naturally split into a page-navigation phase and
// a separate extraction phase. Always paired with ScrapingEngine.Api and
// OutputFormat.Csv, forced in ScrapingPlanBuilder.
public sealed class ApiCallStep : ScrapingStep
{
    public required ApiConfig Config { get; init; }
}
