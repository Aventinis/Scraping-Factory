using System.Reflection;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends;

// Finds code generators and verifiers without a compile-time reference to a backend type, by scanning this assembly.
// Generators are keyed by (LanguageId, Engine); verifiers only by LanguageId (they run whatever the generators produce).
public sealed class LanguageModuleRegistry
{
    private readonly Dictionary<(string LanguageId, ScrapingEngine Engine), ICodeGenerator> _codeGenerators;
    private readonly Dictionary<string, IScriptVerifier> _scriptVerifiers;

    // ctorOverrides reaches optional constructor parameters of discovered backends by name (e.g. PythonScriptVerifier's
    // pythonExecutable, timeout) from configuration; unmatched keys are ignored, unmatched parameters keep their default.
    public LanguageModuleRegistry(IReadOnlyDictionary<string, object?>? ctorOverrides = null)
        : this(Assembly.GetExecutingAssembly(), ctorOverrides)
    {
    }

    public LanguageModuleRegistry(Assembly assembly, IReadOnlyDictionary<string, object?>? ctorOverrides = null)
    {
        _codeGenerators = Discover<ICodeGenerator, (string, ScrapingEngine)>(
            assembly, g => (g.LanguageId, g.Engine), ctorOverrides);
        _scriptVerifiers = Discover<IScriptVerifier, string>(assembly, v => v.LanguageId, ctorOverrides);
    }

    public ICodeGenerator ResolveCodeGenerator(string languageId, ScrapingEngine engine) =>
        _codeGenerators.TryGetValue((languageId, engine), out var generator)
            ? generator
            : throw new InvalidOperationException(
                $"No code generator registered for language '{languageId}' and engine '{engine}'.");

    public IScriptVerifier ResolveScriptVerifier(string languageId) =>
        _scriptVerifiers.TryGetValue(languageId, out var verifier)
            ? verifier
            : throw new InvalidOperationException($"No script verifier registered for language '{languageId}'.");

    private static Dictionary<TKey, T> Discover<T, TKey>(
        Assembly assembly, Func<T, TKey> keySelector, IReadOnlyDictionary<string, object?>? ctorOverrides)
        where T : class
        where TKey : notnull
    {
        var instances = new List<T>();

        foreach (var type in assembly.GetTypes())
        {
            if (type is not { IsClass: true, IsAbstract: false } || !typeof(T).IsAssignableFrom(type))
                continue;

            // Accepts any constructor callable with zero arguments (all-optional included).
            var ctor = type.GetConstructors().FirstOrDefault(c => c.GetParameters().All(p => p.IsOptional));
            if (ctor is null)
                continue;

            var args = ctor.GetParameters()
                .Select(p => ctorOverrides is not null && p.Name is not null &&
                             ctorOverrides.TryGetValue(p.Name, out var overrideValue)
                    ? overrideValue
                    : p.DefaultValue)
                .ToArray();
            instances.Add((T)ctor.Invoke(args));
        }

        return instances.ToDictionary(keySelector);
    }
}
