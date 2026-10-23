using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// An ordered post-processing chain for one extracted value; each step's output feeds the next. Not applied to
// ExtractMode.Exists. Attached separately to ScrapingField/ExtractStep, DataFieldNode and ApiField. An explicit
// "kind" tag: the variants have no structural tell.
[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(TrimTransform), "trim")]
[JsonDerivedType(typeof(RegexExtractTransform), "regexExtract")]
[JsonDerivedType(typeof(ReplaceTransform), "replace")]
[JsonDerivedType(typeof(ToNumberTransform), "toNumber")]
[JsonDerivedType(typeof(ToIntegerTransform), "toInteger")]
[JsonDerivedType(typeof(ToBooleanTransform), "toBoolean")]
[JsonDerivedType(typeof(ToDateTransform), "toDate")]
[JsonDerivedType(typeof(ToCurrencyTransform), "toCurrency")]
[JsonDerivedType(typeof(CombineFieldsTransform), "combineFields")]
[JsonDerivedType(typeof(SplitFieldTransform), "splitField")]
public abstract class FieldTransform
{
}

// What a strict conversion does with a value that is not well-formed: keep it, or substitute DefaultValue.
// There is deliberately no "fail the row" mode (it would need row-dropping machinery per transform).
public enum TransformErrorMode { KeepOriginal, UseDefault }

public sealed class TrimTransform : FieldTransform
{
}

// First match's capture group (0 = whole match); no match gives "". Syntax is pre-checked with .NET's Regex while
// the script runs Python's re, so a few patterns can still differ at run time.
public sealed class RegexExtractTransform : FieldTransform
{
    public required string Pattern { get; init; }
    public int Group { get; init; } = 0;
}

// Literal (not regex) replace of all occurrences.
public sealed class ReplaceTransform : FieldTransform
{
    public required string Find { get; init; }
    public required string Replacement { get; init; }
}

// Best-effort number: finds the numeric substring, guesses the decimal separator, normalizes to "12.99"; "" if none.
public sealed class ToNumberTransform : FieldTransform
{
}

// Strict: only an optional sign and digits (after trimming) convert.
public sealed class ToIntegerTransform : FieldTransform
{
    public TransformErrorMode OnError { get; init; } = TransformErrorMode.KeepOriginal;

    // Required (non-null) when OnError is UseDefault.
    public string? DefaultValue { get; init; }
}

// Strict, from a fixed case-insensitive vocabulary: true/1/yes/y gives "True", false/0/no/n gives "False".
public sealed class ToBooleanTransform : FieldTransform
{
    public TransformErrorMode OnError { get; init; } = TransformErrorMode.KeepOriginal;
    public string? DefaultValue { get; init; }
}

// Strict conversion to ISO "yyyy-mm-dd"; a non-existent date (2026-02-30) fails. SourceFormat uses the
// "{yyyy}/{mm}/{dd}" template of RangeSource.Format; null = already ISO.
public sealed class ToDateTransform : FieldTransform
{
    public string? SourceFormat { get; init; }
    public TransformErrorMode OnError { get; init; } = TransformErrorMode.KeepOriginal;
    public string? DefaultValue { get; init; }
}

// Strict price conversion: the first number in the value, read with an explicit separator convention, to "1234.56"
// (fraction digits kept as scraped). Currency symbols are ignored, not extracted.
public sealed class ToCurrencyTransform : FieldTransform
{
    // One of SupportedFormats; each is written as its own example amount.
    public string Format { get; init; } = DefaultFormat;
    public TransformErrorMode OnError { get; init; } = TransformErrorMode.KeepOriginal;
    public string? DefaultValue { get; init; }

    public const string DefaultFormat = "1.234,56";

    // Mirrored by _CURRENCY_FORMATS in the templates and CURRENCY_FORMATS in field-transforms.js.
    public static readonly IReadOnlyList<string> SupportedFormats = ["1.234,56", "1,234.56", "1 234,56", "1'234.56"];
}

// Derived field: joins the values of two or more fields declared earlier in the same list; ignores its own value.
public sealed class CombineFieldsTransform : FieldTransform
{
    public required List<string> SourceFieldNames { get; init; }
    public string Separator { get; init; } = " ";
}

// Derived field: splits an earlier field's value and keeps the part at Index (0-based; out of range gives "").
public sealed class SplitFieldTransform : FieldTransform
{
    public required string SourceFieldName { get; init; }
    public string Separator { get; init; } = " ";
    public int Index { get; init; } = 0;
}
