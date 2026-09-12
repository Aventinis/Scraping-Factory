using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// Issue #129: opt-in, per-check hardening validation the *generated script*
// runs on itself after scraping — independent of #87's change detection,
// which notifies on data *changing*, not on the scrape *breaking*. The
// companion's own /generate trial run already checks "at least one data
// row" once, but a script re-run later (e.g. via the user's own cron entry,
// weeks after generation) has no equivalent check today — if a selector
// stops matching (site redesign), it silently writes an empty/header-only
// output and exits 0. Each check is independently on/off (simply absent
// from the list when off) and independently configured to either warn
// (printed, script still exits 0) or fail the run (printed, script exits
// EXIT_HARDENING_FAILED — see the Python templates' own shared runtime
// helper) — the caller decides what "broken" means for their own use case.
//
// This is the first of five related checks (see CLAUDE.md) sharing this one
// mechanism; only NoResultCheck is implemented so far. Polymorphic exactly
// like ApiParameterSource/FieldTransform (no natural structural tell
// between kinds), discriminated via an explicit "kind" tag — camelCase
// values, matching those two's own convention ("staticList"/"trim"/...),
// not the wire-format prose in the issue itself.
[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(NoResultCheck), "noResult")]
[JsonDerivedType(typeof(NullRateCheck), "nullRate")]
[JsonDerivedType(typeof(BaselineCheck), "baseline")]
public abstract class HardeningCheck
{
    public required HardeningSeverity Severity { get; init; }
}

public enum HardeningSeverity { Warning, Error }

// Zero data rows (flat/API-flat) or zero elements (container/API-tree)
// after scraping — the classic "site redesign broke a selector, scheduled
// job silently produces nothing" case. No kind-specific parameters.
public sealed class NoResultCheck : HardeningCheck;

// Issue #130: catches the narrower case NoResultCheck can't — the row/
// element count stays healthy, but one specific field's selector quietly
// starts matching the wrong thing and returns empty for every occurrence.
// Threshold is a fraction (0.0-1.0, not a 0-100 percentage) of empty
// occurrences that triggers the check; the extension's own UI collects it
// as a percentage and divides by 100 before sending it. Unlike
// NoResultCheck, more than one NullRateCheck is expected — one per field
// the caller wants monitored — so ScrapingPlanValidator's "duplicate kind"
// rule is relaxed to a "duplicate FieldName" rule for this kind
// specifically (see ValidateHardening). FieldName is matched at runtime
// against the flat row's dict key (flat/API-flat) or, container/API-tree
// mode, every element with that tag name anywhere in the output tree —
// i.e. globally per field name, not scoped to whichever parent group it's
// nested under (a deliberate simplification; see the issue's own "open
// design questions" section and CLAUDE.md).
public sealed class NullRateCheck : HardeningCheck
{
    public required string FieldName { get; init; }
    public required double Threshold { get; init; }
}

// Issue #131: catches a gradual drop in result volume that neither
// NoResultCheck (only fires at exactly zero) nor NullRateCheck (only
// watches one field's own emptiness) would ever trip — e.g. a paginated
// list quietly losing entries because a "load more" selector broke, while
// every individual field on every remaining row still extracts fine.
// DropThreshold is a fraction (0.0-1.0, same convention as
// NullRateCheck.Threshold) of the *previous* run's own result count — a
// drop strictly greater than this fraction triggers the check. Unlike
// NullRateCheck, only one BaselineCheck ever makes sense (there's only one
// "the" result count to track), so ScrapingPlanValidator's existing
// duplicate-kind rule applies unchanged, with no NullRateCheck-style
// exemption needed.
//
// The "previous run's own result count" itself is not part of this wire
// type at all — it's runtime state the generated script tracks for itself
// in a small sidecar JSON file next to its own output file (deliberately
// not reusing #87 ChangeDetectionConfig's "compare against the previous
// output" mechanism: that one diffs the *entire* output file's content on
// every run, unconditionally; this one only ever needs one integer, and —
// per the issue's own "a bad run must never become the new normal"
// requirement — must only update after a run that didn't itself hard-fail,
// which is a materially different update rule from ChangeDetection's
// unconditional overwrite-every-run). "Didn't hard-fail" means the same
// thing it does everywhere else in this mechanism: no *Error*-severity
// check reported a problem — a Warning-severity trigger (including from
// this very check comparing against the old baseline) still advances the
// baseline forward, exactly as a Warning never changes anything else about
// how a run is treated. See the Python templates' own
// _read_baseline/_write_baseline for the actual file format and update
// logic.
public sealed class BaselineCheck : HardeningCheck
{
    public required double DropThreshold { get; init; }
}
