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
[JsonDerivedType(typeof(BlockingCheck), "blocking")]
[JsonDerivedType(typeof(RequiredFieldsCheck), "requiredFields")]
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

// Issue #132: catches a site that starts blocking the script (rate-limiting,
// IP ban, a CAPTCHA wall, a redirect to a login page) while still responding
// with a normal-looking HTTP 200 — response.raise_for_status() alone won't
// catch it, and the "blocked" response can still contain enough markup to
// produce a non-empty result that passes NoResultCheck and doesn't
// necessarily trip NullRateCheck either. Unlike NoResultCheck/NullRateCheck,
// this evaluates the *raw* response captured at request time (final URL,
// body length, body text), not the already-extracted data/output tree.
//
// Three signals, all evaluated per captured response:
//  - the final URL's host differs from the requested URL's host (a redirect
//    to a different origin, e.g. a CAPTCHA vendor or a login subdomain) —
//    always checked, no configuration needed;
//  - the response body is shorter than MinBodyLength bytes (null = signal
//    disabled) — for the Browser engine, "bytes" is approximated as the
//    UTF-8-encoded length of the rendered page content, since Playwright has
//    no single raw response body to measure after JS execution;
//  - the response body contains one of BlockPhrases (case-insensitive
//    substring match, e.g. "Access Denied", "Please verify you are human") —
//    empty/null list = signal disabled.
//
// Only one BlockingCheck ever makes sense (like BaselineCheck), so
// ScrapingPlanValidator's existing duplicate-kind rule applies unchanged.
// Detection-and-reporting only — actually bypassing/solving a block or
// CAPTCHA is explicitly out of scope (see CLAUDE.md's Feature Scope "No
// CAPTCHA solving/bypassing" boundary).
public sealed class BlockingCheck : HardeningCheck
{
    public int? MinBodyLength { get; init; }
    public List<string>? BlockPhrases { get; init; }
}

// Issue #133: unlike the four checks above, this one changes what actually
// gets written, not just what gets reported about what was already
// written — a row missing a non-empty value for any of FieldNames is
// dropped from the output entirely (rather than written with a blank
// cell), serving the issue's own "safe for DB import" motivation (a
// NOT NULL column that would otherwise silently break on import). The
// filtering itself always happens regardless of Severity; only whether the
// *run* is flagged as failed afterward depends on it — an all-Warning
// configuration still guarantees the output file never contains a row
// missing a required value, without necessarily failing the whole run.
//
// Flat-shaped output (Fields/flat mode, Api-mode's flat ItemsPath/Fields
// shape) and container mode both support this check; Api-mode's tree shape
// (Groups) still doesn't — ScrapingPlanValidator rejects that specific
// combination (see ValidateApiConfig's call site in Validate()).
//
// Container mode has no flat "row" the way flat mode does, so FieldNames
// is matched *globally by tag name anywhere in the built output tree* —
// the same simplification NullRateCheck already established for this
// exact ambiguity (see its own doc comment). What gets dropped when a
// match is empty is the *nearest enclosing repeating group instance*: the
// runtime's extract_group() walker (language-modules/python/templates/
// scraper_grouped.py.j2/playwright_scraper_grouped.py.j2) already builds
// each repeating instance bottom-up before deciding whether to append it
// to its parent, so checking "does this instance's own subtree contain an
// empty required field" at exactly that point naturally drops whichever
// nesting level actually contains the problem, without needing to track
// "nearest repeating ancestor" as separate schema metadata. A required
// field with no repeating ancestor above it (or only non-repeating
// ancestors) has no "instance" to drop, so it's simply left as an empty
// element — a deliberate, documented limitation, not a bug. Only one
// RequiredFieldsCheck ever makes sense, so the existing duplicate-kind
// rule applies unchanged.
public sealed class RequiredFieldsCheck : HardeningCheck
{
    public required List<string> FieldNames { get; init; }
}
