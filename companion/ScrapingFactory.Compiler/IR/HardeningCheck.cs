using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// Checks the generated script runs on its own result after scraping, on every run (not only the trial run), so a
// scheduled job notices a site change. Each check warns (script still exits 0) or fails the run
// (EXIT_HARDENING_FAILED). Absent from the list = off. Behavior per check: docs/design-notes/compiler.md.
// An explicit "kind" tag: the variants have no structural tell.
[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(NoResultCheck), "noResult")]
[JsonDerivedType(typeof(NullRateCheck), "nullRate")]
[JsonDerivedType(typeof(BaselineCheck), "baseline")]
[JsonDerivedType(typeof(BlockingCheck), "blocking")]
[JsonDerivedType(typeof(RequiredFieldsCheck), "requiredFields")]
public abstract class HardeningCheck
{
    public required HardeningSeverity Severity { get; init; }
}

public enum HardeningSeverity { Warning, Error }

// Zero rows (flat) or zero elements (tree) after scraping.
public sealed class NoResultCheck : HardeningCheck;

// One field is empty too often. Threshold is a fraction (0.0-1.0). More than one is allowed, one per FieldName.
// FieldName is matched globally by name (flat: the row key; tree: every element with that tag), not per parent group.
public sealed class NullRateCheck : HardeningCheck
{
    public required string FieldName { get; init; }
    public required double Threshold { get; init; }
}

// The result count dropped by more than DropThreshold (a fraction) against the previous run. The previous count
// is runtime state in a sidecar file, only advanced by a run that did not fail with severity Error.
public sealed class BaselineCheck : HardeningCheck
{
    public required double DropThreshold { get; init; }
}

// The site answers 200 but blocks: evaluated on the raw response, not on the extracted data. Signals: the final
// host differs from the requested one (always on), the body is shorter than MinBodyLength bytes, the body contains
// one of BlockPhrases (case-insensitive). Detects and reports only; never works around a block.
public sealed class BlockingCheck : HardeningCheck
{
    public int? MinBodyLength { get; init; }
    public List<string>? BlockPhrases { get; init; }
}

// Unlike the others this changes the output: a row (flat) or the nearest enclosing repeating group instance (tree)
// with an empty value for any of FieldNames is dropped, whatever the severity; severity only decides whether the
// run is flagged as failed. Tree shapes match FieldNames globally by tag name.
public sealed class RequiredFieldsCheck : HardeningCheck
{
    public required List<string> FieldNames { get; init; }
}
