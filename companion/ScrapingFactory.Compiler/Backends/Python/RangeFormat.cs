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
        _ => throw new ArgumentOutOfRangeException(nameof(type), type, "RangeType.Number hat kein Format."),
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
            return $"unbekannte(r) Platzhalter {string.Join(", ", unknown.Select(t => $"{{{t}}}"))} (erlaubt: {string.Join(", ", required.Select(t => $"{{{t}}}"))}).";

        var missing = required.Except(used).ToList();
        if (missing.Count > 0)
            return $"muss {string.Join(" und ", missing.Select(t => $"{{{t}}}"))} enthalten.";

        var duplicate = used.GroupBy(t => t).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
        if (duplicate.Count > 0)
            return $"{string.Join(", ", duplicate.Select(t => $"{{{t}}}"))} darf nur einmal vorkommen.";

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

    private static Regex CompilePattern(string format)
    {
        var pattern = Regex.Escape(format);
        foreach (var (token, valuePattern) in TokenValuePatterns)
            pattern = pattern.Replace(Regex.Escape("{" + token + "}"), $"(?<{token}>{valuePattern})");
        return new Regex($"^{pattern}$");
    }
}
