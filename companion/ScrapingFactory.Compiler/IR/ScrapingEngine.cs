namespace ScrapingFactory.Compiler.IR;

public enum ScrapingEngine
{
    // requests + BeautifulSoup: no JS execution, fast, the v1 default.
    Static,

    // Playwright + Chromium: renders JS before extracting, needed for
    // dynamically loaded content. Heavier and slower than Static.
    Browser,

    // API-Mode (Issue #53): calls a JSON API endpoint directly via requests,
    // no HTML rendering or parsing at all. Conceptually not really a
    // "rendering engine" the way Static/Browser are, but reusing this axis
    // is the cheapest way to plug into LanguageModuleRegistry's existing
    // (LanguageId, Engine) codegen lookup — a deliberate compromise, not a
    // perfect model (see issue #53's architecture notes).
    Api,
}
