using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Language backend: generates a standalone Python script from a ScrapingConfig IR.
// v1 target: requests + BeautifulSoup (static pages only, no JS rendering).
// Uses template-based generation (templates in language-modules/python/templates/).
public sealed class PythonCodeGenerator
{
    public string Generate(ScrapingConfig config)
    {
        // TODO: implement full template rendering (Phase 3)
        throw new NotImplementedException("PythonCodeGenerator is not yet implemented.");
    }
}
