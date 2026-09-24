using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// Issue #84: an optional, ordered post-processing chain for a single
// extracted field value — e.g. "extract just the number out of 'Preis:
// 12,99 €'" without the user having to hand-edit the generated script
// afterwards. Applied in list order, each step's output feeding the next
// step's input, starting from the field's raw extracted string. Not
// meaningful for ExtractMode.Exists (a boolean-ish presence check, not a
// string pipeline) — the extension UI hides the transform section for that
// mode, and the code generators simply never apply it there.
//
// Attached independently to all three field-shape leaf types
// (ScrapingField/ExtractStep for flat mode, DataFieldNode for container
// mode, ApiField for API mode) since none of them share a common base type —
// see ScrapingPlanBuilder's doc-comment on why flat mode's translation is a
// pure 1:1 passthrough while container/API mode's leaves flow straight from
// wire format into codegen unchanged.
//
// Discriminated via an explicit "kind" JSON tag, mirroring ApiParameterSource
// (IR/ApiConfig.cs) rather than a structural sniff like ContainerNodeJsonConverter
// — these four kinds have no natural structural tell apart (compare
// GroupNode/DataFieldNode, which do).
[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(TrimTransform), "trim")]
[JsonDerivedType(typeof(RegexExtractTransform), "regexExtract")]
[JsonDerivedType(typeof(ReplaceTransform), "replace")]
[JsonDerivedType(typeof(ToNumberTransform), "toNumber")]
[JsonDerivedType(typeof(ToIntegerTransform), "toInteger")]
[JsonDerivedType(typeof(ToBooleanTransform), "toBoolean")]
[JsonDerivedType(typeof(ToDateTransform), "toDate")]
public abstract class FieldTransform
{
}

// Shared by every explicit type-conversion transform below (Issue #205) —
// what happens when a value turns out not to actually be well-formed for
// the target type. Deliberately just two modes, not the full three the
// issue's own prose floated ("skip the step and keep the raw value / fail
// the field / a configurable default value"): "fail the field" would need
// the same kind of row/element-dropping machinery RequiredFieldsCheck
// (Issue #133) only built at real cost, for a hardening check that runs
// once at the very end — wiring an equivalent per-transform, per-value
// failure signal back out through flat/container/API-tree extraction was
// judged not worth it for what's fundamentally the same "safe default"
// need UseDefault already covers. KeepOriginal is the default so an
// unconfigured conversion never silently discards data the way "fail"
// would.
public enum TransformErrorMode { KeepOriginal, UseDefault }

// Strips leading/trailing whitespace — the single most common "the site put
// extra spaces/newlines around this" case, kept as its own step rather than
// something every other transform does implicitly, so it composes with the
// others in whatever order the user actually wants.
public sealed class TrimTransform : FieldTransform
{
}

// First regex match's given capture group (0 = the whole match); no match at
// all -> empty string, same "don't fail the whole row over one field" spirit
// PythonScriptVerifier's own error handling already follows elsewhere.
// Validated structurally in ScrapingPlanValidator (via
// Backends/Python/FieldTransformValidator) before the real script run —
// same "fast pre-check" role RangeFormat.ValidateFormat already plays for
// RangeSource.Format. Known risk, same class as RangeFormat's own
// doc-comment: .NET's Regex and Python's re module aren't 100%
// syntax-identical, so a pattern that compiles here could still behave
// subtly differently (or fail) in the generated script's actual re.search
// call — this is a best-effort structural check, not a full guarantee.
public sealed class RegexExtractTransform : FieldTransform
{
    public required string Pattern { get; init; }
    public int Group { get; init; } = 0;
}

// Plain literal substring replace (all occurrences) — deliberately not
// regex-based, since RegexExtractTransform already covers the regex case;
// keeping this one regex-free avoids two overlapping "regex" concepts in
// the same small transform set.
public sealed class ReplaceTransform : FieldTransform
{
    public required string Find { get; init; }
    public required string Replacement { get; init; }
}

// Auto-detects the numeric substring and its decimal separator (handles
// both "12,99" and "12.99" styles, strips thousands separators/currency
// symbols) and normalizes it to a plain '.'-decimal numeric string — or an
// empty string if nothing numeric is found. Deliberately parameter-free to
// keep this transform set small and well-defined (per Issue #84's own scope
// note); a user needing more control over which substring counts as "the
// number" can chain a RegexExtractTransform before this one.
public sealed class ToNumberTransform : FieldTransform
{
}

// Issue #205: strict integer conversion — unlike ToNumberTransform's
// heuristic decimal-separator/thousands-separator handling, this only ever
// accepts a value that, once trimmed, is nothing but an optional sign and
// digits (e.g. "42"/"-7"); "12.5"/"1,234" are conversion failures, not
// approximated. Chain a RegexExtractTransform/ToNumberTransform first to
// pull a clean integer-looking substring out of noisier text.
public sealed class ToIntegerTransform : FieldTransform
{
    public TransformErrorMode OnError { get; init; } = TransformErrorMode.KeepOriginal;

    // Only meaningful (and only applied) when OnError is UseDefault — see
    // FieldTransformValidator. Null there is a validation error, not an
    // implicit "" fallback, so a caller can't silently end up with an empty
    // string that just happens to also be a valid ToInteger output.
    public string? DefaultValue { get; init; }
}

// Issue #205: strict boolean conversion against a small, fixed,
// case-insensitive vocabulary (true/1/yes/y -> "True", false/0/no/n ->
// "False") — deliberately not configurable (same "keep the transform set
// small and well-defined" reasoning ToNumberTransform's own doc comment
// already gives), since the scrape-and-report data this project targets
// realistically only ever encodes booleans one of these few ways.
public sealed class ToBooleanTransform : FieldTransform
{
    public TransformErrorMode OnError { get; init; } = TransformErrorMode.KeepOriginal;
    public string? DefaultValue { get; init; }
}

// Issue #205: strict date conversion to canonical ISO 8601 ("yyyy-mm-dd").
// SourceFormat is the same "{yyyy}"/"{mm}"/"{dd}" mini-template
// RangeSource.Format (RangeFormat.cs) already establishes for ISO
// week/date API parameters — reusing RangeFormat.ValidateFormat(Date, ...)
// for structural validation and RangeFormat.DefaultDateFormat ("{yyyy}-
// {mm}-{dd}", i.e. already ISO) as the default when unset, rather than
// inventing a second mini-template syntax. Conversion also checks the
// value is a real calendar date (e.g. "2026-02-30" fails), not just that
// it structurally matches the format.
public sealed class ToDateTransform : FieldTransform
{
    public string? SourceFormat { get; init; }
    public TransformErrorMode OnError { get; init; } = TransformErrorMode.KeepOriginal;
    public string? DefaultValue { get; init; }
}
