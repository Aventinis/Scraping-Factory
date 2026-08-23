using System.Reflection;

namespace ScrapingFactory.Compiler.Backends;

// Looks up code generators/verifiers by language id without any compile-time
// reference to a concrete backend type (e.g. PythonCodeGenerator) outside of
// Backends/Python itself. Discovery is a reflection scan of this assembly —
// sufficient as long as every language module ships in-process; splitting
// modules into separately loaded plugin assemblies is a later concern, not
// needed while Python is the only backend.
public sealed class LanguageModuleRegistry
{
    private readonly Dictionary<string, ICodeGenerator> _codeGenerators;
    private readonly Dictionary<string, IScriptVerifier> _scriptVerifiers;

    public LanguageModuleRegistry() : this(Assembly.GetExecutingAssembly())
    {
    }

    public LanguageModuleRegistry(Assembly assembly)
    {
        _codeGenerators = Discover<ICodeGenerator>(assembly, g => g.LanguageId);
        _scriptVerifiers = Discover<IScriptVerifier>(assembly, v => v.LanguageId);
    }

    public ICodeGenerator ResolveCodeGenerator(string languageId) =>
        _codeGenerators.TryGetValue(languageId, out var generator)
            ? generator
            : throw new InvalidOperationException($"Kein Codegenerator für Sprache '{languageId}' registriert.");

    public IScriptVerifier ResolveScriptVerifier(string languageId) =>
        _scriptVerifiers.TryGetValue(languageId, out var verifier)
            ? verifier
            : throw new InvalidOperationException($"Kein Skript-Verifier für Sprache '{languageId}' registriert.");

    private static Dictionary<string, T> Discover<T>(Assembly assembly, Func<T, string> keySelector)
        where T : class
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
