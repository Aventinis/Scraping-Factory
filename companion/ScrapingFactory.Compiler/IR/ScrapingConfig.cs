namespace ScrapingFactory.Compiler.IR;

// Intermediate Representation (IR) — language-agnostic scraping configuration.
// Every language backend consumes this type to generate its target code.
// Schema must be finalized and versioned before implementing any language backend.
public sealed class ScrapingConfig
{
    // TODO: define IR schema (URL, fields/selectors, output format, …)
}
