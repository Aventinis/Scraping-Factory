using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.Backends.Python;

namespace ScrapingFactory.Compiler.IR;

public static partial class ScrapingPlanValidator
{
    // Issue #129/#130: every non-NullRate check kind (the concrete
    // HardeningCheck subtype, since there's no separate string "Kind"
    // property to compare on the C# side; that string only exists on the
    // wire/in the generated script) may appear at most once — Severity is a
    // required enum (an invalid string already fails deserialization before
    // this ever runs), and NoResultCheck has no parameters of its own, so
    // there's nothing that would distinguish two instances of it anyway.
    // NullRateCheck is deliberately exempt from that rule (see its own doc
    // comment) — more than one is expected, one per monitored field — so it
    // gets its own "duplicate FieldName" rule plus its own parameter checks
    // instead.
    private static string? ValidateHardening(List<HardeningCheck> hardening)
    {
        var duplicateKind = hardening
            .Where(check => check is not NullRateCheck)
            .GroupBy(check => check.GetType())
            .FirstOrDefault(group => group.Count() > 1)
            ?.Key.Name;
        if (duplicateKind is not null)
            return $"Hardening check '{duplicateKind}' is configured more than once.";

        var nullRateChecks = hardening.OfType<NullRateCheck>().ToList();

        var duplicateField = nullRateChecks
            .GroupBy(check => check.FieldName)
            .FirstOrDefault(group => group.Count() > 1)
            ?.Key;
        if (duplicateField is not null)
            return $"Hardening check 'NullRate' is configured more than once for field '{duplicateField}'.";

        foreach (var check in nullRateChecks)
        {
            if (string.IsNullOrWhiteSpace(check.FieldName))
                return "Hardening check 'NullRate' needs a field name.";
            if (check.Threshold is < 0 or > 1)
                return $"Hardening check 'NullRate' for field '{check.FieldName}': threshold must be between 0 and 1 (was {check.Threshold}).";
        }

        // Issue #131: only DropThreshold's own range needs checking —
        // BaselineCheck already goes through the generic duplicate-kind rule
        // above like NoResultCheck, since more than one never makes sense.
        foreach (var check in hardening.OfType<BaselineCheck>())
        {
            if (check.DropThreshold is < 0 or > 1)
                return $"Hardening check 'Baseline': threshold must be between 0 and 1 (was {check.DropThreshold}).";
        }

        // Issue #132: like BaselineCheck, only one BlockingCheck ever makes
        // sense (already covered by the generic duplicate-kind rule above).
        // MinBodyLength/BlockPhrases are both optional — a BlockingCheck
        // with neither set is still meaningful (the cross-origin-redirect
        // signal is always active), so there's no "at least one signal
        // configured" requirement here.
        foreach (var check in hardening.OfType<BlockingCheck>())
        {
            if (check.MinBodyLength is <= 0)
                return $"Hardening check 'Blocking': MinBodyLength must be positive (was {check.MinBodyLength}).";
            if (check.BlockPhrases?.Any(string.IsNullOrWhiteSpace) == true)
                return "Hardening check 'Blocking': block phrases must not be blank.";
        }

        // Issue #133 (+ #204 follow-up): unlike BlockingCheck's optional
        // signals, FieldNames is the one thing this check configures at
        // all, so — unlike an incomplete NullRateCheck row, which is simply
        // skipped client-side — an empty list is rejected here rather than
        // silently doing nothing. Supported for every shape (flat, Api-flat,
        // container, and — since #204 — Api-tree), so there's no per-shape
        // restriction to enforce anywhere else in this validator.
        foreach (var check in hardening.OfType<RequiredFieldsCheck>())
        {
            if (check.FieldNames.Count == 0)
                return "Hardening check 'RequiredFields' needs at least one field name.";
            if (check.FieldNames.Any(string.IsNullOrWhiteSpace))
                return "Hardening check 'RequiredFields': field names must not be blank.";
            var duplicateFieldName = FindDuplicates(check.FieldNames, name => name).FirstOrDefault();
            if (duplicateFieldName is not null)
                return $"Hardening check 'RequiredFields': duplicate field name '{duplicateFieldName}'.";
        }

        return null;
    }
}
