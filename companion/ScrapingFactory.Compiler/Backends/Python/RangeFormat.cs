using System.Globalization;
using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Compiles a RangeSource.Format mini-template ("{yyyy}"/"{ww}"/"{mm}"/"{dd}"
// tokens, everything else literal) into a regex, used by
// ScrapingPlanValidator to reject a From/To value that wouldn't actually
// parse — before a real script run ever sees it. Mirrors, token for token,
// the same mini-syntax scraper_api.py.j2's runtime _parse_range_value/
// _render_range_value understand, so a value accepted here is guaranteed to
// parse there too (and vice versa for what gets rendered back). Only
// IsoWeek/Date sources carry a Format; Number is plain integer parsing.
internal static class RangeFormat
{
    public const string DefaultIsoWeekFormat = "{yyyy}-W{ww}";
    public const string DefaultDateFormat = "{yyyy}-{mm}-{dd}";

    // The token set a Format is allowed to use, per RangeType — also the
    // set that MUST all be present exactly once, since a missing token
    // would make the format ambiguous to parse/render and an unknown one
    // would silently become dead literal text no real value could ever
    // match (see ValidateFormat).
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

    // Null = valid (including the "no Format set → default applies" case).
    // Number is never passed here — ScrapingPlanValidator handles it as
    // plain int parsing instead, see ValidateRangeSource.
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

    // `allowToday` mirrors scraper_api.py.j2's asymmetric handling: IsoWeek
    // resolves "today" for both From and To (they share one parse helper
    // there), Date only special-cases it for To (From always goes through
    // date.fromisoformat) — see _iso_week_range/_date_range. Passing the
    // wrong allowToday here would accept a value the generated script then
    // rejects, defeating the point of validating ahead of the real run.
    public static bool IsValid(string value, string format, bool allowToday) =>
        (allowToday && value == "today") || CompilePattern(format).IsMatch(value);

    // Issue #295: how many values the generated script's own
    // _iso_week_range/_date_range/_number_range will expand this source to
    // (inclusive on both ends, an inverted range yields none) — needed only
    // to estimate how many real requests a trial run makes, never to build
    // the values themselves. "today" resolves against the companion's clock,
    // like the script's own date.today() does at run time. Null when a
    // value doesn't parse (ScrapingPlanValidator rejects those before any
    // estimate is made, so this is just a defensive fallback).
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
