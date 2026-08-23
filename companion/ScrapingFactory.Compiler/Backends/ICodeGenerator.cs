using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends;

public interface ICodeGenerator
{
    string LanguageId { get; }

    string Generate(ScrapingConfig config);
}
