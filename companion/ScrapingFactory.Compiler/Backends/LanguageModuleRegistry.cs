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

    // ctorOverrides lets a caller (Program.cs, driven by appsettings.json's
    // "Companion" section) reach into an otherwise-opaque, reflectively
    // discovered backend's own optional constructor parameters by name —
    // e.g. PythonScriptVerifier's (pythonExecutable, timeout) — without this
    // registry needing any compile-time knowledge of which backends exist or
    // which parameters they expose. A key with no matching parameter on a
    // given type is simply ignored; a parameter with no matching key keeps
    // its normal C# default.
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

            // Accept any constructor that can be invoked with zero
            // arguments (all-optional included, e.g. PythonScriptVerifier's
            // (pythonExecutable = null, timeout = null)) so backends aren't
            // forced into a plain parameterless constructor just to be
            // discoverable.
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
