using System.Globalization;
using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Compiles a RangeSource.Format mini-template ("{yyyy}"/"{ww}"/"{mm}"/"{dd}", everything else literal) into a regex so
// ScrapingPlanValidator can reject a From/To that would not parse. Mirrors the runtime's _parse_range_value /
// _render_range_value (test-vectors/range-format.json pins them). Only IsoWeek/Date carry a Format.
internal static class RangeFormat
{
    public const string DefaultIsoWeekFormat = "{yyyy}-W{ww}";
    public const string DefaultDateFormat = "{yyyy}-{mm}-{dd}";

    // The tokens a Format may use per type; all must occur exactly once (a missing one is ambiguous, an unknown one
    // becomes dead literal text).
    private static readonly Dictionary<RangeType, string[]> TokensByType = new()
    {
        [RangeType.IsoWeek] = ["yyyy", "ww"],
        [RangeType.Date] = ["yyyy", "mm", "dd"],
    };

    private static readonly Dictionary<string, string> TokenValuePatterns = new()
    {
        ["yyyy"] = @"\d{4}",
        ["ww"] = @"\d{1,2}",
        ["mm"] = @"\d{1,2}",
        ["dd"] = @"\d{1,2}",
    };

    private static readonly Regex TokenPlaceholderPattern = new(@"\{([a-z]+)\}");

    public static string Resolve(RangeType type, string? format) => format ?? type switch
    {
        RangeType.IsoWeek => DefaultIsoWeekFormat,
        RangeType.Date => DefaultDateFormat,
        _ => throw new ArgumentOutOfRangeException(nameof(type), type, "RangeType.Number has no format."),
    };

    // Null = valid (including "no Format"). Number never gets here.
    public static string? ValidateFormat(RangeType type, string? format)
    {
        if (format is null)
            return null;

        var required = TokensByType[type];
        var used = TokenPlaceholderPattern.Matches(format).Select(match => match.Groups[1].Value).ToList();

        var unknown = used.Except(required).ToList();
        if (unknown.Count > 0)
            return $"unknown placeholder(s) {string.Join(", ", unknown.Select(t => $"{{{t}}}"))} (allowed: {string.Join(", ", required.Select(t => $"{{{t}}}"))}).";

        var missing = required.Except(used).ToList();
        if (missing.Count > 0)
            return $"must contain {string.Join(" and ", missing.Select(t => $"{{{t}}}"))}.";

        var duplicate = used.GroupBy(t => t).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
        if (duplicate.Count > 0)
            return $"{string.Join(", ", duplicate.Select(t => $"{{{t}}}"))} must not occur more than once.";

        return null;
    }

    // allowToday mirrors the script: IsoWeek resolves "today" for From and To, Date only for To. A wrong value here
    // would accept something the script then rejects.
    public static bool IsValid(string value, string format, bool allowToday) =>
        (allowToday && value == "today") || CompilePattern(format).IsMatch(value);

    // How many values the script's own range helpers will expand this source to (inclusive, an inverted range is empty);
    // used only to estimate the trial run's duration. "today" uses the companion's clock. Null for an unparsable value
    // (the validator rejects those first).
    public static long? CountValues(RangeSource source)
    {
        try
        {
            switch (source.Type)
            {
                case RangeType.Number:
                    if (!long.TryParse(source.From, out var from) || !long.TryParse(source.To, out var to))
                        return null;
                    return Math.Max(0, to - from + 1);

                case RangeType.IsoWeek:
                {
                    var format = Resolve(RangeType.IsoWeek, source.Format);
                    var start = ParseIsoWeekMonday(source.From, format);
                    var end = ParseIsoWeekMonday(source.To, format);
                    if (start is null || end is null)
                        return null;
                    return Math.Max(0, (end.Value.DayNumber - start.Value.DayNumber) / 7 + 1);
                }

                default:
                {
                    var format = Resolve(RangeType.Date, source.Format);
                    var start = ParseDate(source.From, format);
                    var end = source.To == "today" ? DateOnly.FromDateTime(DateTime.Today) : ParseDate(source.To, format);
                    if (start is null || end is null)
                        return null;
                    return Math.Max(0, end.Value.DayNumber - start.Value.DayNumber + 1);
                }
            }
        }
        catch (ArgumentException)
        {
            // e.g. month 13, or ISO week 53 in a year that only has 52.
            return null;
        }
    }

    private static DateOnly? ParseIsoWeekMonday(string value, string format)
    {
        if (value == "today")
        {
            var today = DateTime.Today;
            return DateOnly.FromDateTime(ISOWeek.ToDateTime(ISOWeek.GetYear(today), ISOWeek.GetWeekOfYear(today), DayOfWeek.Monday));
        }

        var match = CompilePattern(format).Match(value);
        if (!match.Success)
            return null;
        var year = int.Parse(match.Groups["yyyy"].Value);
        var week = int.Parse(match.Groups["ww"].Value);
        if (week < 1 || week > ISOWeek.GetWeeksInYear(year))
            return null;
        return DateOnly.FromDateTime(ISOWeek.ToDateTime(year, week, DayOfWeek.Monday));
    }

    private static DateOnly? ParseDate(string value, string format)
    {
        var match = CompilePattern(format).Match(value);
        if (!match.Success)
            return null;
        return new DateOnly(
            int.Parse(match.Groups["yyyy"].Value), int.Parse(match.Groups["mm"].Value), int.Parse(match.Groups["dd"].Value));
    }

    private static Regex CompilePattern(string format)
    {
        var pattern = Regex.Escape(format);
        foreach (var (token, valuePattern) in TokenValuePatterns)
            pattern = pattern.Replace(Regex.Escape("{" + token + "}"), $"(?<{token}>{valuePattern})");
        return new Regex($"^{pattern}$");
    }
}
