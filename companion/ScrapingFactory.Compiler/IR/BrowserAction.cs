using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// Wire form of WaitForStep/FillStep/ClickStep/ScrollStep: an ordered list translated 1:1 into steps by
// ScrapingPlanBuilder, after navigation and before extraction. An explicit "kind" tag.
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
    public ClickTarget Target { get; init; } = ClickTarget.First;

    // Only for ClickTarget.All: pause after each click.
    public int WaitAfterMs { get; init; } = ClickStep.DefaultWaitAfterMs;
}

public sealed class ScrollAction : BrowserAction
{
    public string? ContainerSelector { get; init; }
    public string? LoadMoreButtonSelector { get; init; }
    public int MaxIterations { get; init; } = 10;
    public int WaitAfterMs { get; init; } = 1000;

    // See ScrollStep.ScrollStepPx.
    public int? ScrollStepPx { get; init; }
    public List<string>? FramePath { get; init; }
}
