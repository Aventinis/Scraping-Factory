namespace ScrapingFactory.Compiler.IR;

public enum ScrapingEngine
{
    // requests + BeautifulSoup: no JS execution, fast, the v1 default.
    Static,

    // Playwright + Chromium: renders JS before extracting, needed for
    // dynamically loaded content. Heavier and slower than Static.
    Browser,
}
