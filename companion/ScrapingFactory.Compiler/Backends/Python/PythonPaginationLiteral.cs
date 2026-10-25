using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Builds the `pagination.*` Scriban context for the four non-API templates; every field is always emitted, so the
// templates only branch on `enabled` / `kind`.
internal static class PythonPaginationLiteral
{
    public static object BuildContext(PaginationConfig? pagination)
    {
        if (pagination is null)
        {
            return new
            {
                enabled = false,
                // Plain kind for Scriban branching, apart from the quoted *_literal fields.
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
