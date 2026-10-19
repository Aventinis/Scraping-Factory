using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Issue #227: builds `text_selector.*` for the Scriban templates — just an
// `enabled` flag, true when any element selector anywhere in the plan ends in
// `:contains("text")`. Only then do the templates include the runtime helpers
// (fragments/text_selector_*.py.j2) that teach BeautifulSoup/Playwright that
// suffix; a plan without one produces exactly the script it always did.
internal static class PythonTextSelectorLiteral
{
    public static object BuildContext(ScrapingPlan plan) => new { enabled = AnyTextFilter(plan) };

    public static bool AnyTextFilter(ScrapingPlan plan) => AllSelectors(plan).Any(SelectorTextFilter.HasTextFilter);

    private static IEnumerable<string?> AllSelectors(ScrapingPlan plan)
    {
        foreach (var step in plan.Steps)
        {
            switch (step)
            {
                case WaitForStep wait: yield return wait.Selector; break;
                case FillStep fill: yield return fill.Selector; break;
                case ClickStep click: yield return click.Selector; break;
                case ScrollStep scroll:
                    yield return scroll.ContainerSelector;
                    yield return scroll.LoadMoreButtonSelector;
                    break;
                case ExtractStep extract: yield return extract.Selector; break;
                case ExtractGroupStep groups:
                    foreach (var selector in NodeSelectors(groups.Roots)) yield return selector;
                    break;
                case ExtractionBlockStep blocks:
                    foreach (var block in blocks.Blocks)
                    {
                        foreach (var field in block.Fields ?? []) yield return field.Selector;
                        foreach (var selector in NodeSelectors(block.Groups ?? [])) yield return selector;
                    }
                    break;
                case ApiCallStep api:
                    foreach (var selector in DiscoveryActionSelectors(api.Config)) yield return selector;
                    break;
            }
        }

        if (plan.Pagination is NextLinkPagination nextLink)
            yield return nextLink.NextLinkSelector;
        yield return plan.DiscoveredUrls?.LinkSelector;
    }

    private static IEnumerable<string?> NodeSelectors(IEnumerable<ContainerNode> nodes)
    {
        foreach (var node in nodes)
        {
            switch (node)
            {
                case GroupNode group:
                    yield return group.Selector;
                    foreach (var selector in NodeSelectors(group.Children)) yield return selector;
                    break;
                case DataFieldNode field:
                    yield return field.Selector;
                    break;
            }
        }
    }

    // Browser-discovery actions run in their own Playwright session inside an
    // API-mode script, through the same _resolve_locator the Browser engine uses.
    private static IEnumerable<string?> DiscoveryActionSelectors(ApiConfig api)
    {
        foreach (var parameter in api.Parameters)
        {
            if (parameter.Source is not BrowserDiscoverySource discovery)
                continue;
            foreach (var action in discovery.Actions ?? [])
            {
                switch (action)
                {
                    case WaitForAction wait: yield return wait.Selector; break;
                    case FillAction fill: yield return fill.Selector; break;
                    case ClickAction click: yield return click.Selector; break;
                    case ScrollAction scroll:
                        yield return scroll.ContainerSelector;
                        yield return scroll.LoadMoreButtonSelector;
                        break;
                }
            }
        }
    }
}
