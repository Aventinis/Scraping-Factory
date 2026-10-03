using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// Wire-format counterpart of WaitForStep/FillStep/ClickStep/ScrollStep — an
// ordered list on ScrapingConfig.BrowserActions, translated 1:1 into the
// matching IR step by ScrapingPlanBuilder, in list order, after NavigateStep
// and before extraction. Before this existed, WaitFor/Fill/Click had no wire
// representation at all and were only reachable by hand-constructing a
// ScrapingPlan in-process (e.g. in tests) — ScrollStep needed a wire path
// regardless, so this closes that pre-existing gap for all four at once
// instead of bolting on a ScrollStep-only special case. Discriminated the
// same way ApiParameterSource is (System.Text.Json's built-in polymorphism,
// an explicit "kind" property) — these four variants have no natural
// structural tell to sniff, unlike GroupNode/DataFieldNode.
[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(WaitForAction), "waitFor")]
[JsonDerivedType(typeof(FillAction), "fill")]
[JsonDerivedType(typeof(ClickAction), "click")]
[JsonDerivedType(typeof(ScrollAction), "scroll")]
public abstract class BrowserAction
{
}

public sealed class WaitForAction : BrowserAction
{
    public required string Selector { get; init; }
    public int TimeoutMs { get; init; } = 5000;
    public List<string>? FramePath { get; init; }
}

public sealed class FillAction : BrowserAction
{
    public required string Selector { get; init; }
    public required string EnvironmentVariableName { get; init; }
    public List<string>? FramePath { get; init; }
}

public sealed class ClickAction : BrowserAction
{
    public required string Selector { get; init; }
    public List<string>? FramePath { get; init; }
}

public sealed class ScrollAction : BrowserAction
{
    public string? ContainerSelector { get; init; }
    public string? LoadMoreButtonSelector { get; init; }
    public int MaxIterations { get; init; } = 10;
    public int WaitAfterMs { get; init; } = 1000;

    // Issue #289: null (the default) keeps today's exact behavior — jump
    // straight to the current bottom of the page/container every iteration,
    // which is correct for classic "infinite scroll" (new items simply
    // append below the old ones). When set, each iteration instead scrolls
    // by exactly this many pixels — needed for a site that lazy-loads a
    // section only once it's actually scrolled *through* (an
    // IntersectionObserver per section), where jumping straight to the
    // bottom skips every section in between without it ever entering the
    // viewport. See ScrollStep's own identical field for the runtime side.
    public int? ScrollStepPx { get; init; }
    public List<string>? FramePath { get; init; }
}
