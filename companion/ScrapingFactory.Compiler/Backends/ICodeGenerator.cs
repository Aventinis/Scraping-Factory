using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends;

public interface ICodeGenerator
{
    string LanguageId { get; }
    ScrapingEngine Engine { get; }

    string Generate(ScrapingPlan plan);
}
