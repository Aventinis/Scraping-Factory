using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Structural pre-check for Issue #84's field-transform chain, called from
// ScrapingPlanValidator at each of the three field-shape validation sites
// (flat ExtractStep, container-mode DataFieldNode, API-mode ApiField) —
// same "static helper returning string? (null = valid)" pattern
// RangeFormat.ValidateFormat already establishes for a different
// user-supplied-pattern case (RangeSource.Format).
//
// Known risk, same class as RangeFormat's own doc-comment: this compiles
// RegexExtractTransform.Pattern via .NET's Regex, but the generated script
// applies it via Python's re module at runtime — the two engines aren't
// 100% syntax-identical (e.g. named-group syntax, some Unicode escapes,
// possessive quantifiers), so a pattern that compiles here could still
// behave subtly differently, or fail outright, once PythonScriptVerifier
// actually runs the script. This check catches outright syntax errors
// early; it is not a guarantee of Python-side correctness.
internal static class FieldTransformValidator
{
    public static string? Validate(IEnumerable<FieldTransform>? transforms, string fieldLabel)
    {
        if (transforms is null)
            return null;

        foreach (var transform in transforms)
        {
            if (transform is RegexExtractTransform regexExtract)
            {
                if (string.IsNullOrEmpty(regexExtract.Pattern))
                    return $"Regex-Muster für {fieldLabel} darf nicht leer sein.";

                try
                {
                    _ = new Regex(regexExtract.Pattern);
                }
                catch (ArgumentException ex)
                {
                    return $"Ungültiger regulärer Ausdruck '{regexExtract.Pattern}' für {fieldLabel}: {ex.Message}";
                }

                if (regexExtract.Group < 0)
                    return $"Gruppenindex für {fieldLabel} darf nicht negativ sein.";
            }

            // TrimTransform/ReplaceTransform/ToNumberTransform: nothing to
            // validate structurally — an empty Find/Replacement is a valid
            // (if useless) no-op, and ToNumberTransform has no parameters at
            // all.
        }

        return null;
    }
}
