using System.Reflection;
using Scriban;

namespace ScrapingFactory.Compiler.Backends;

// Shared embedded-resource loading for Scriban templates, used by every
// code generator so template-loading/parse-error handling isn't duplicated
// per backend.
internal static class EmbeddedScribanTemplate
{
    public static Template Load(Assembly assembly, string resourceName)
    {
        using var stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException($"Embedded template '{resourceName}' not found in assembly.");
        using var reader = new StreamReader(stream);
        var templateText = reader.ReadToEnd();

        var template = Template.Parse(templateText);
        if (template.HasErrors)
            throw new InvalidOperationException(
                $"Template parse errors in '{resourceName}': {string.Join(", ", template.Messages)}");

        return template;
    }
}
