namespace ScrapingFactory.Compiler.IR;

// Issue #218: a lightweight pre-run pass that harvests every href matching
// LinkSelector from PageUrl, resolved to an absolute URL, and feeds the
// result into NavigateStep.Urls alongside Url/AdditionalUrls — for a target
// whose set of listing/category pages isn't fixed (e.g. a navigation menu
// that changes over time) rather than typed by hand once and left stale.
// Mode-independent for Fields/Groups (mutually exclusive with Api, enforced
// in Program.cs's /generate handler — Api mode never reads the
// page-scraping start URL at all, same reasoning as AdditionalUrls/
// Pagination). Composes with AdditionalUrls (additive — both lists combined)
// and with Pagination (each discovered URL paginates onward independently,
// exactly like every other start URL already does).
//
// A plain class, not polymorphic — unlike PaginationConfig's two kinds,
// there's only ever one discovery mechanic here. Deliberately
// requests+BeautifulSoup only for this first version, even on a
// Browser-engine script — no Playwright fallback for JS-rendered
// navigation, the issue's own "likely doesn't need the Browser engine for
// the common case" framing, the same "ship the simpler mechanism first"
// precedent DiscoverySource (Issue #53) already set before
// BrowserDiscoverySource (Issue #216) existed.
public sealed class DiscoveredUrlsConfig
{
    public required string PageUrl { get; init; }

    // CSS selector matched against PageUrl's own HTML — every matching
    // element's href attribute is harvested (an element with no href is
    // silently skipped, e.g. a user accidentally pointing at a non-anchor).
    public required string LinkSelector { get; init; }

    // Safety cap, always active — mirrors PaginationConfig.MaxPages's own
    // "always active, sane default" convention. A misconfigured selector
    // matching an entire sitemap/nav tree shouldn't silently balloon a run
    // to thousands of pages.
    public int MaxUrls { get; init; } = 100;
}
