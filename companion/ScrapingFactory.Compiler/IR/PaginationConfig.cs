using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// Issue #174: opt-in classic multi-page pagination (page 1, 2, 3, … via a
// "next" link or a page-number URL template) — distinct from infinite-
// scroll/"load more" pagination on a single page, already covered by
// ScrollStep (Issue #41). Mode-independent (Fields/Groups alike), mutually
// exclusive with Api (enforced in Program.cs's /generate handler — Api mode
// never reads the page-scraping start URL at all, so this would silently do
// nothing there, same reasoning as AdditionalUrls). Composes with
// AdditionalUrls: each start URL (Url + every AdditionalUrls entry)
// paginates onward independently, entirely inside the generated script's own
// scrape() function — see the Python templates.
//
// Polymorphic exactly like ApiParameterSource/FieldTransform/HardeningCheck
// (no natural structural tell between the two kinds), discriminated via an
// explicit "kind" tag.
[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(NextLinkPagination), "nextLink")]
[JsonDerivedType(typeof(PageNumberPagination), "pageNumber")]
public abstract class PaginationConfig
{
    // Hard safety cap on how many pages are ever fetched from one start URL
    // (including page 1) — always active regardless of kind, so a
    // misconfigured/buggy "next" link that never disappears, or a
    // page-number template that never yields an empty page, can't turn into
    // an unbounded loop.
    public int MaxPages { get; init; } = 50;
}

// CSS selector for the "next page" link, relative to the current page —
// resolved via its href attribute (urljoin'd against the current page's own
// URL), for both engines alike. A JS-driven "next" control with no real href
// (client-side-routed SPA pagination) isn't followable this way — same class
// of documented limitation as CSS-selector-compatibility/virtual-scrolling
// elsewhere in this project (see CLAUDE.md), not something this check
// attempts to solve. Pagination stops once this selector no longer matches
// on a page (in addition to the always-active empty-page/MaxPages stops).
public sealed class NextLinkPagination : PaginationConfig
{
    public required string NextLinkSelector { get; init; }
}

// Page 1 is always the start URL exactly as given (Url or one AdditionalUrls
// entry) — UrlTemplate only ever generates page 2 onward, by substituting
// "{url}" (that same start URL, unchanged) and "{page}" (2, 3, 4, …) into it,
// e.g. "{url}?page={page}". Both placeholders are required (enforced in
// ScrapingPlanValidator) — a template with no "{page}" would just refetch
// the same URL forever until MaxPages, and one with no "{url}" couldn't
// express "the same listing, page N" for more than one start URL at once,
// defeating the whole point of composing with AdditionalUrls.
public sealed class PageNumberPagination : PaginationConfig
{
    public required string UrlTemplate { get; init; }
}
