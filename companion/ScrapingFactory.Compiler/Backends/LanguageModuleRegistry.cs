using System.Reflection;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends;

// Looks up code generators/verifiers without any compile-time reference to a
// concrete backend type (e.g. PythonCodeGenerator) outside of Backends/Python
// itself. Discovery is a reflection scan of this assembly — sufficient as
// long as every language module ships in-process; splitting modules into
// separately loaded plugin assemblies is a later concern.
//
// Code generators are keyed by (LanguageId, Engine): the same language can
// have multiple backends (e.g. Python via requests+BeautifulSoup for the
// Static engine, Python via Playwright for the Browser engine). Verifiers
// only need LanguageId — they just run whatever script the language's
// generators produce, regardless of which engine generated it.
public sealed class LanguageModuleRegistry
{
    private readonly Dictionary<(string LanguageId, ScrapingEngine Engine), ICodeGenerator> _codeGenerators;
    private readonly Dictionary<string, IScriptVerifier> _scriptVerifiers;

    public LanguageModuleRegistry() : this(Assembly.GetExecutingAssembly())
    {
    }

    public LanguageModuleRegistry(Assembly assembly)
    {
        _codeGenerators = Discover<ICodeGenerator, (string, ScrapingEngine)>(
            assembly, g => (g.LanguageId, g.Engine));
        _scriptVerifiers = Discover<IScriptVerifier, string>(assembly, v => v.LanguageId);
    }

    public ICodeGenerator ResolveCodeGenerator(string languageId, ScrapingEngine engine) =>
        _codeGenerators.TryGetValue((languageId, engine), out var generator)
            ? generator
            : throw new InvalidOperationException(
                $"Kein Codegenerator für Sprache '{languageId}' und Engine '{engine}' registriert.");

    public IScriptVerifier ResolveScriptVerifier(string languageId) =>
        _scriptVerifiers.TryGetValue(languageId, out var verifier)
            ? verifier
            : throw new InvalidOperationException($"Kein Skript-Verifier für Sprache '{languageId}' registriert.");

    private static Dictionary<TKey, T> Discover<T, TKey>(Assembly assembly, Func<T, TKey> keySelector)
        where T : class
        where TKey : notnull
    {
        var instances = new List<T>();

        foreach (var type in assembly.GetTypes())
        {
            if (type is not { IsClass: true, IsAbstract: false } || !typeof(T).IsAssignableFrom(type))
                continue;

            // Accept any constructor that can be invoked with zero
            // arguments (all-optional included, e.g. PythonScriptVerifier's
            // (pythonExecutable = null, timeout = null)) so backends aren't
            // forced into a plain parameterless constructor just to be
            // discoverable.
            var ctor = type.GetConstructors().FirstOrDefault(c => c.GetParameters().All(p => p.IsOptional));
            if (ctor is null)
                continue;

            var args = ctor.GetParameters().Select(p => p.DefaultValue).ToArray();
            instances.Add((T)ctor.Invoke(args));
        }

        return instances.ToDictionary(keySelector);
    }
}
