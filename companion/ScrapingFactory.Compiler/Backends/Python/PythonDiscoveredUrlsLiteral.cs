using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Issue #218: builds the single Scriban context object every one of the
// four non-API templates (scraper.py.j2, playwright_scraper.py.j2,
// scraper_grouped.py.j2, playwright_scraper_grouped.py.j2) renders
// `discovered_urls.*` from — mirrors PythonPaginationLiteral/PythonProxyLiteral
// exactly: always emits every field regardless of whether the feature is
// active, so the template layer only ever branches on `enabled`.
internal static class PythonDiscoveredUrlsLiteral
{
    public static object BuildContext(DiscoveredUrlsConfig? discoveredUrls)
    {
        if (discoveredUrls is null)
        {
            return new
            {
                enabled = false,
                page_url_literal = "None",
                link_selector_literal = "None",
                max_urls_literal = "0",
            };
        }

        return new
        {
            enabled = true,
            page_url_literal = PythonLiteral.Str(discoveredUrls.PageUrl),
            link_selector_literal = PythonLiteral.Str(discoveredUrls.LinkSelector),
            max_urls_literal = PythonLiteral.Num(discoveredUrls.MaxUrls),
        };
    }
}
