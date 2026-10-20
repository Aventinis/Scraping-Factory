using System.Text;

namespace ScrapingFactory.Compiler.IR;

// Issue #227: a selector may end in `:contains("text")` — not standard CSS
// (a jQuery/Sizzle extension soupsieve doesn't implement), but the one case
// nothing else expresses: a button identified only by its label. The CSS part
// in front of it is matched as usual; the matches are then filtered by their
// text. Matching is deliberately tolerant — the element's whole text
// (descendants included) is reduced to single spaces, both sides are
// lower-cased, and the wanted text only has to occur in it — so "in den
// warenkorb" finds "In den  Warenkorb". The Python runtime (text_selector_*
// fragments) and the extension's content script implement the same rule; this
// class only *validates* the syntax at /generate time, so a malformed filter
// fails with a readable message instead of a soupsieve/Playwright error deep
// inside the trial run.
//
// Syntax: the filter is the very last part of the selector, the text is quoted
// with ' or " (\", \' and \\ escape), and there is at most one filter.
public static class SelectorTextFilter
{
    private const string Marker = ":contains(";

    public static bool HasTextFilter(string? selector) =>
        selector is not null && selector.Contains(Marker, StringComparison.OrdinalIgnoreCase);

    // The CSS part and the (unescaped) text, or (selector, null) when there is
    // no filter. Throws FormatException for a malformed one — callers that
    // want a message instead use Validate first.
    public static (string BaseSelector, string? Text) Split(string selector)
    {
        var start = selector.IndexOf(Marker, StringComparison.OrdinalIgnoreCase);
        if (start < 0)
            return (selector, null);

        var error = TryParseFilter(selector, start, out var text);
        if (error is not null)
            throw new FormatException(error);

        var baseSelector = selector[..start].TrimEnd();
        return (baseSelector.Length == 0 ? "*" : baseSelector, text);
    }

    // null = valid (including "no filter at all").
    public static string? Validate(string? selector, string label)
    {
        if (!HasTextFilter(selector))
            return null;
        var start = selector!.IndexOf(Marker, StringComparison.OrdinalIgnoreCase);
        var error = TryParseFilter(selector, start, out _);
        return error is null ? null : $"{label}: {error}";
    }

    // Used where a selector isn't a plain element selector (an iframe path
    // segment, the embedded-JSON script tag): the filter isn't supported
    // there, and silently passing it to soupsieve/Playwright would fail late.
    public static string? ValidateNotAllowed(string? selector, string label) =>
        HasTextFilter(selector)
            ? $"{label}: :contains(\"…\") is not supported here — use a plain CSS selector."
            : null;

    private static string? TryParseFilter(string selector, int start, out string text)
    {
        text = "";
        var i = start + Marker.Length;
        while (i < selector.Length && char.IsWhiteSpace(selector[i])) i++;
        if (i >= selector.Length || selector[i] is not ('"' or '\''))
            return "write the text in quotes, e.g. :contains(\"Add to cart\").";

        var quote = selector[i++];
        var builder = new StringBuilder();
        var closed = false;
        while (i < selector.Length)
        {
            var c = selector[i++];
            if (c == '\\' && i < selector.Length)
            {
                builder.Append(selector[i++]);
                continue;
            }
            if (c == quote)
            {
                closed = true;
                break;
            }
            builder.Append(c);
        }
        if (!closed)
            return "the quoted text in :contains(...) is not closed.";

        while (i < selector.Length && char.IsWhiteSpace(selector[i])) i++;
        if (i >= selector.Length || selector[i] != ')')
            return "expected a closing ) right after the quoted text in :contains(...).";
        i++;
        while (i < selector.Length && char.IsWhiteSpace(selector[i])) i++;
        if (i < selector.Length)
            return ":contains(...) must be the last part of the selector (and used only once).";

        text = builder.ToString();
        if (string.IsNullOrWhiteSpace(text))
            return "the text in :contains(...) must not be empty.";
        return null;
    }
}
