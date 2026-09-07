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
public abstract class FieldTransform
{
}

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
