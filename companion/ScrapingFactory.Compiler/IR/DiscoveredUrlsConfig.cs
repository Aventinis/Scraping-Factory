namespace ScrapingFactory.Compiler.IR;

// Harvests extra start URLs from a navigation page before the run, for targets whose set of pages changes.
// Fields/Groups only; additive with AdditionalUrls; each discovered URL paginates independently. Plain
// requests + BeautifulSoup even in a Browser-engine script.
public sealed class DiscoveredUrlsConfig
{
    public required string PageUrl { get; init; }

    // Matched against PageUrl's HTML; each match's href is harvested (elements without one are skipped).
    public required string LinkSelector { get; init; }

    // Safety cap against a selector that matches a whole sitemap.
    public int MaxUrls { get; init; } = 100;
}
