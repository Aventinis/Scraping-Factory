using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Structural pre-check of a field's transform chain (null = valid), called wherever a field is validated. The regex
// pattern is compiled with .NET's Regex while the script uses Python's re, so a few patterns can still behave
// differently at run time: this catches outright syntax errors early, not Python-side correctness. Also checks the
// strict conversions' OnError/DefaultValue contract; a ToDate format is validated like RangeSource.Format.
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

            // UseDefault without a DefaultValue is ambiguous, so it is rejected. Currency: only the fixed presets, the runtime's
            // format table knows nothing else.
            if (transform is ToCurrencyTransform toCurrency && !ToCurrencyTransform.SupportedFormats.Contains(toCurrency.Format))
                return $"Currency format '{toCurrency.Format}' for {fieldLabel} is not supported (expected one of: {string.Join(", ", ToCurrencyTransform.SupportedFormats)}).";

            if (transform is ToIntegerTransform or ToBooleanTransform or ToDateTransform or ToCurrencyTransform)
            {
                var (onError, defaultValue) = transform switch
                {
                    ToIntegerTransform t => (t.OnError, t.DefaultValue),
                    ToBooleanTransform t => (t.OnError, t.DefaultValue),
                    ToDateTransform t => (t.OnError, t.DefaultValue),
                    ToCurrencyTransform t => (t.OnError, t.DefaultValue),
                    _ => throw new InvalidOperationException("Unreachable."),
                };

                if (onError == TransformErrorMode.UseDefault && defaultValue is null)
                    return $"Default value for {fieldLabel} must be set when the conversion's error behavior is 'use default value'.";
            }

            // Structural only: that the referenced names exist and are declared earlier is ScrapingPlanValidator.ValidateFieldTransformOrdering's job.
            if (transform is CombineFieldsTransform combine)
            {
                if (combine.SourceFieldNames is not { Count: >= 2 })
                    return $"Combine transform for {fieldLabel} needs at least 2 source fields.";
                if (combine.SourceFieldNames.Any(string.IsNullOrWhiteSpace))
                    return $"Combine transform for {fieldLabel} has a blank source field name.";
                if (combine.SourceFieldNames.Distinct().Count() != combine.SourceFieldNames.Count)
                    return $"Combine transform for {fieldLabel} lists the same source field more than once.";
            }

            if (transform is SplitFieldTransform split)
            {
                if (string.IsNullOrWhiteSpace(split.SourceFieldName))
                    return $"Split transform for {fieldLabel} needs a source field.";
                if (split.Index < 0)
                    return $"Split index for {fieldLabel} must not be negative.";
            }

            // Trim / Replace / ToNumber: nothing to validate.
        }

        return null;
    }
}
