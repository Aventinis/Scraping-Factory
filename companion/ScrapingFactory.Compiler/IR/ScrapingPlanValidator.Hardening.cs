using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.Backends.Python;

namespace ScrapingFactory.Compiler.IR;

public static partial class ScrapingPlanValidator
{
    // Each check kind may appear once, except NullRateCheck (one per monitored field, unique by FieldName).
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

        // Only the threshold's range needs checking.
        foreach (var check in hardening.OfType<BaselineCheck>())
        {
            if (check.DropThreshold is < 0 or > 1)
                return $"Hardening check 'Baseline': threshold must be between 0 and 1 (was {check.DropThreshold}).";
        }

        // MinBodyLength/BlockPhrases are optional: the cross-origin-redirect signal is always active.
        foreach (var check in hardening.OfType<BlockingCheck>())
        {
            if (check.MinBodyLength is <= 0)
                return $"Hardening check 'Blocking': MinBodyLength must be positive (was {check.MinBodyLength}).";
            if (check.BlockPhrases?.Any(string.IsNullOrWhiteSpace) == true)
                return "Hardening check 'Blocking': block phrases must not be blank.";
        }

        // FieldNames is this check's only setting, so an empty list is rejected instead of doing nothing.
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
