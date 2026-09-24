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
//
// Issue #205: also validates the three explicit type-conversion kinds
// (ToIntegerTransform/ToBooleanTransform/ToDateTransform) — their shared
// OnError/DefaultValue contract, plus ToDateTransform's own SourceFormat
// mini-template (delegated straight to RangeFormat.ValidateFormat, the
// exact same validation RangeSource.Format already gets for the Date
// RangeType).
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
                    return $"Regex pattern for {fieldLabel} must not be empty.";

                try
                {
                    _ = new Regex(regexExtract.Pattern);
                }
                catch (ArgumentException ex)
                {
                    return $"Invalid regular expression '{regexExtract.Pattern}' for {fieldLabel}: {ex.Message}";
                }

                if (regexExtract.Group < 0)
                    return $"Group index for {fieldLabel} must not be negative.";
            }

            if (transform is ToDateTransform toDate && toDate.SourceFormat is not null)
            {
                var formatError = RangeFormat.ValidateFormat(RangeType.Date, toDate.SourceFormat);
                if (formatError is not null)
                    return $"Date format for {fieldLabel} {formatError}";
            }

            // Issue #205: every type-conversion transform shares the same
            // OnError/DefaultValue contract — UseDefault without an actual
            // DefaultValue is ambiguous (there's no sensible implicit
            // fallback value), so it's rejected the same structural way an
            // empty regex pattern already is above.
            if (transform is ToIntegerTransform or ToBooleanTransform or ToDateTransform)
            {
                var (onError, defaultValue) = transform switch
                {
                    ToIntegerTransform t => (t.OnError, t.DefaultValue),
                    ToBooleanTransform t => (t.OnError, t.DefaultValue),
                    ToDateTransform t => (t.OnError, t.DefaultValue),
                    _ => throw new InvalidOperationException("Unreachable."),
                };

                if (onError == TransformErrorMode.UseDefault && defaultValue is null)
                    return $"Default value for {fieldLabel} must be set when the conversion's error behavior is 'use default value'.";
            }

            // TrimTransform/ReplaceTransform/ToNumberTransform: nothing to
            // validate structurally — an empty Find/Replacement is a valid
            // (if useless) no-op, and ToNumberTransform has no parameters at
            // all.
        }

        return null;
    }
}
