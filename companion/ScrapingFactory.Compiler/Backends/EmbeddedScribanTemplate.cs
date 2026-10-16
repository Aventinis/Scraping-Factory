using System.Reflection;
using System.Text.RegularExpressions;
using Scriban;

namespace ScrapingFactory.Compiler.Backends;

// Shared embedded-resource loading for Scriban templates, used by every
// code generator so template-loading/parse-error handling isn't duplicated
// per backend.
//
// Scriban has no cross-template includes, which used to force every shared
// runtime helper (the transform helpers, retry, proxy, baseline, ...) to be
// copy-pasted into each template. Instead the compiler does the include
// itself, as plain text substitution *before* Scriban parses anything: a
// line consisting of
//
//     #@include <name>
//
// (any indentation) is replaced by the embedded fragment
// `fragments/<name>.py.j2` (see language-modules/python/templates/fragments),
// re-indented to the directive's indentation. Fragments are ordinary Scriban
// text rendered with the including template's own context — they can use
// `{{ if retry.enabled }}` etc. like the template itself — and may include
// other fragments. As a `#` line the directive is still a harmless comment
// if a template is ever read as Python.
internal static partial class EmbeddedScribanTemplate
{
    private const string FragmentResourcePrefix = "fragments/";
    private const string FragmentResourceSuffix = ".py.j2";

    // Guards against a fragment (indirectly) including itself.
    private const int MaxIncludeDepth = 16;

    [GeneratedRegex(@"^(?<indent>[ \t]*)#@include[ \t]+(?<name>[A-Za-z0-9_./-]+)[ \t]*(?=\r?$)", RegexOptions.Multiline)]
    private static partial Regex IncludeDirective();

    public static Template Load(Assembly assembly, string resourceName)
    {
        var templateText = ReadResource(assembly, resourceName)
            ?? throw new InvalidOperationException($"Embedded template '{resourceName}' not found in assembly.");
        templateText = ExpandIncludes(templateText, name => ReadResource(assembly, FragmentResourcePrefix + name + FragmentResourceSuffix), resourceName);

        var template = Template.Parse(templateText);
        if (template.HasErrors)
            throw new InvalidOperationException(
                $"Template parse errors in '{resourceName}': {string.Join(", ", template.Messages)}");

        return template;
    }

    private static string? ReadResource(Assembly assembly, string resourceName)
    {
        using var stream = assembly.GetManifestResourceStream(resourceName);
        if (stream is null) return null;
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    // `resolve` maps a fragment name to its text (null = no such fragment).
    // The directive line is replaced by the fragment text minus its trailing
    // line breaks, so extracting a block of a template verbatim into a
    // fragment and including it back yields exactly the original text.
    internal static string ExpandIncludes(string text, Func<string, string?> resolve, string owner)
        => ExpandIncludes(text, resolve, owner, [owner]);

    private static string ExpandIncludes(string text, Func<string, string?> resolve, string owner, List<string> chain)
    {
        if (chain.Count > MaxIncludeDepth)
            throw new InvalidOperationException($"Template includes are nested too deeply ({string.Join(" -> ", chain)}).");

        return IncludeDirective().Replace(text, match =>
        {
            var name = match.Groups["name"].Value;
            if (chain.Contains(name))
                throw new InvalidOperationException($"Circular template include: {string.Join(" -> ", chain)} -> {name}.");

            var fragment = resolve(name)
                ?? throw new InvalidOperationException($"Fragment '{name}' included from '{owner}' was not found (expected embedded resource '{FragmentResourcePrefix}{name}{FragmentResourceSuffix}').");

            chain.Add(name);
            try
            {
                var expanded = ExpandIncludes(fragment.TrimEnd('\r', '\n'), resolve, name, chain);
                return Indent(expanded, match.Groups["indent"].Value);
            }
            finally
            {
                chain.RemoveAt(chain.Count - 1);
            }
        });
    }

    // Blank lines stay empty (no trailing whitespace is introduced).
    private static string Indent(string text, string indent)
    {
        if (indent.Length == 0) return text;
        var lines = text.Split('\n');
        return string.Join("\n", lines.Select(line => line.Trim('\r').Length == 0 ? line : indent + line));
    }
}
