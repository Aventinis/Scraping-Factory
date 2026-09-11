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
public abstract class HardeningCheck
{
    public required HardeningSeverity Severity { get; init; }
}

public enum HardeningSeverity { Warning, Error }

// Zero data rows (flat/API-flat) or zero elements (container/API-tree)
// after scraping — the classic "site redesign broke a selector, scheduled
// job silently produces nothing" case. No kind-specific parameters.
public sealed class NoResultCheck : HardeningCheck;
