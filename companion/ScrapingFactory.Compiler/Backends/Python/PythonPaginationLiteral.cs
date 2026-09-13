using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Issue #174: builds the single Scriban context object every one of the
// four non-API templates (scraper.py.j2, playwright_scraper.py.j2,
// scraper_grouped.py.j2, playwright_scraper_grouped.py.j2) renders
// `pagination.*` from — mirrors PythonChangeDetectionLiteral/
// PythonProxyLiteral exactly: always emits every possible field regardless
// of which kind (or no kind at all) is active, so the template layer never
// has to branch on which shape of object it got, only on `enabled`/`kind`.
internal static class PythonPaginationLiteral
{
    public static object BuildContext(PaginationConfig? pagination)
    {
        if (pagination is null)
        {
            return new
            {
                enabled = false,
                // Plain "nextLink"/"pageNumber" (not Python-literal-quoted) —
                // used for Scriban {{ if }} branching, kept separate from the
                // *_literal fields below (the quoted form actually emitted as
                // Python source), same "template layer never compares against
                // a string-with-quotes" convention change_detection.notify_method
                // already established.
                kind = (string?)null,
                next_link_selector_literal = "None",
                url_template_literal = "None",
                max_pages_literal = "0",
            };
        }

        return new
        {
            enabled = true,
            kind = pagination switch
            {
                NextLinkPagination => "nextLink",
                PageNumberPagination => "pageNumber",
                _ => throw new InvalidOperationException($"Unknown PaginationConfig type: {pagination.GetType()}"),
            },
            next_link_selector_literal = pagination is NextLinkPagination nextLink ? PythonLiteral.Str(nextLink.NextLinkSelector) : "None",
            url_template_literal = pagination is PageNumberPagination pageNumber ? PythonLiteral.Str(pageNumber.UrlTemplate) : "None",
            max_pages_literal = PythonLiteral.Num(pagination.MaxPages),
        };
    }
}
