using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// Classic multi-page pagination (page 1, 2, 3, … via a "next" link or a page-number URL template), as opposed to
// infinite scroll (ScrollStep). Fields/Groups only; each start URL paginates independently. An explicit "kind" tag.
[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(NextLinkPagination), "nextLink")]
[JsonDerivedType(typeof(PageNumberPagination), "pageNumber")]
public abstract class PaginationConfig
{
    // Safety cap on pages per start URL (including page 1), whatever the kind.
    public int MaxPages { get; init; } = 50;
}

// The "next page" link's href (urljoin'd against the current URL). A link without a real href (client-side
// routing) cannot be followed. Stops when the selector no longer matches.
public sealed class NextLinkPagination : PaginationConfig
{
    public required string NextLinkSelector { get; init; }
}

// Page 1 is the start URL as given; UrlTemplate generates page 2 onward from "{url}" (the start URL) and "{page}",
// e.g. "{url}?page={page}". "{page}" is always required; "{url}" only with several start pages (so a start URL that
// already carries "?page=1" can use "https://site/list?page={page}").
public sealed class PageNumberPagination : PaginationConfig
{
    public required string UrlTemplate { get; init; }
}
