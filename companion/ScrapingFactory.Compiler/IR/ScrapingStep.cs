namespace ScrapingFactory.Compiler.IR;

public abstract class ScrapingStep
{
}

// Every start URL (Url plus AdditionalUrls), at least one. Only the page-scraping generators read it.
public sealed class NavigateStep : ScrapingStep
{
    public required List<string> Urls { get; init; }
}

public sealed class ExtractStep : ScrapingStep
{
    public required string Name { get; init; }

    // Blank only for a derived field (see ScrapingField.Selector).
    public string? Selector { get; init; }

    // null = text content; "href", "src", … = attribute value.
    public string? Attribute { get; init; }

    // Browser engine only: CSS selectors of the iframes from the top document down to the one holding Selector.
    // Shadow DOM needs nothing: Playwright pierces open shadow roots.
    public List<string>? FramePath { get; init; }

    public List<FieldTransform>? Transforms { get; init; }

    // Requires Attribute; see ScrapingField.
    public bool Download { get; init; }
    public int? MaxDownloadSizeBytes { get; init; }
    public List<string>? AllowedContentTypes { get; init; }

    public bool HiddenFromOutput { get; init; }
}

// Browser engine only: waits for a selector to appear. FramePath is absolute from the top document, like ExtractStep's.
public sealed class WaitForStep : ScrapingStep
{
    public required string Selector { get; init; }
    public int TimeoutMs { get; init; } = 5000;
    public List<string>? FramePath { get; init; }
}

// Browser engine only: fills a field from an environment variable (a credential never appears in the script).
public sealed class FillStep : ScrapingStep
{
    public required string Selector { get; init; }
    public required string EnvironmentVariableName { get; init; }
    public List<string>? FramePath { get; init; }
}

// Browser engine only: a click; waiting for the result is a separate WaitForStep.
public sealed class ClickStep : ScrapingStep
{
    public const int DefaultWaitAfterMs = 250;

    public required string Selector { get; init; }

    // Playwright's click aborts on a selector with several matches (strict mode), so a target is explicit:
    // First/Last click that match, All clicks every match in order and pauses WaitAfterMs after each.
    public ClickTarget Target { get; init; } = ClickTarget.First;
    public int WaitAfterMs { get; init; } = DefaultWaitAfterMs;

    public List<string>? FramePath { get; init; }
}

// Browser engine only: scrolls and/or clicks a "load more" button until nothing new appears, at most
// MaxIterations rounds. With a button, its disappearance stops the loop; without one, the page or container
// no longer growing for two rounds does. See playwright_scroll_step.py.j2.
public sealed class ScrollStep : ScrapingStep
{
    public string? ContainerSelector { get; init; }
    public string? LoadMoreButtonSelector { get; init; }
    public int MaxIterations { get; init; } = 10;
    public int WaitAfterMs { get; init; } = 1000;

    // null = jump to the bottom each round; set = scroll by this many pixels, for sections that only load once
    // scrolled through.
    public int? ScrollStepPx { get; init; }

    // Applies to ContainerSelector and LoadMoreButtonSelector alike.
    public List<string>? FramePath { get; init; }
}

// Container mode; engine-independent (only the DOM calls in the generated extract_group() differ).
public sealed class ExtractGroupStep : ScrapingStep
{
    public required List<GroupNode> Roots { get; init; }
}

// API mode: one step, since fetching and parsing a JSON response is not split into navigate and extract.
public sealed class ApiCallStep : ScrapingStep
{
    public required ApiConfig Config { get; init; }
}

// Blocks mode: every independent extraction block of one run, sharing one NavigateStep.
public sealed class ExtractionBlockStep : ScrapingStep
{
    public required List<PlanExtractionBlock> Blocks { get; init; }
}

// The resolved ExtractionBlockConfig: exactly one of Fields/Groups is set, output format and file name are final.
public sealed class PlanExtractionBlock
{
    public required string Name { get; init; }
    public List<ExtractStep>? Fields { get; init; }
    public List<GroupNode>? Groups { get; init; }
    public required OutputFormat OutputFormat { get; init; }
    public required string OutputFileBaseName { get; init; }
    public ChangeDetectionConfig? ChangeDetection { get; init; }
    public List<HardeningCheck>? Hardening { get; init; }
}

public enum ClickTarget { First, Last, All }
