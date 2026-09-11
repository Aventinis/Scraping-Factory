using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Issue #129: builds the single Scriban context object every one of the six
// templates renders `hardening.*` from — mirrors PythonProxyLiteral/
// PythonChangeDetectionLiteral's own BuildContext shape exactly.
// checks_literal is a Python list-of-dicts literal (e.g.
// [{"kind": "noResult", "severity": "Error"}]) or "[]" when no checks are
// configured; the runtime side (_run_hardening_checks in the templates)
// dispatches on each dict's "kind" — only "noResult" exists today, see
// HardeningCheck's own doc comment for the other four planned kinds.
internal static class PythonHardeningLiteral
{
    public static object BuildContext(List<HardeningCheck>? checks)
    {
        var list = checks ?? [];
        return new { enabled = list.Count > 0, checks_literal = RenderChecks(list) };
    }

    private static string RenderChecks(List<HardeningCheck> checks)
    {
        if (checks.Count == 0) return "[]";
        return "[" + string.Join(", ", checks.Select(RenderCheck)) + "]";
    }

    private static string RenderCheck(HardeningCheck check)
    {
        var kind = check switch
        {
            NoResultCheck => "noResult",
            _ => throw new InvalidOperationException($"Unbekannter HardeningCheck-Typ: {check.GetType()}"),
        };
        return $$"""{"kind": {{PythonLiteral.Str(kind)}}, "severity": {{PythonLiteral.Str(check.Severity.ToString())}}}""";
    }
}
