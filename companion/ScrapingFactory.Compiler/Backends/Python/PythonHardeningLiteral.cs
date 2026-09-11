using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Issue #129: builds the single Scriban context object every one of the six
// templates renders `hardening.*` from — mirrors PythonProxyLiteral/
// PythonChangeDetectionLiteral's own BuildContext shape exactly.
// checks_literal is a Python list-of-dicts literal (e.g.
// [{"kind": "noResult", "severity": "Error"}]) or "[]" when no checks are
// configured; the runtime side (_run_hardening_checks in the templates)
// dispatches on each dict's "kind" — "noResult", "nullRate" (Issue #130),
// and "baseline" (Issue #131; see HardeningCheck's own doc comment for the
// two still-planned kinds). has_baseline additionally gates the templates'
// own sidecar-file read/write helpers and their `import json` — the only
// kind so far needing on-disk state between runs, so it's the only one
// that needs its own top-level context flag rather than just living inside
// checks_literal.
internal static class PythonHardeningLiteral
{
    public static object BuildContext(List<HardeningCheck>? checks)
    {
        var list = checks ?? [];
        return new
        {
            enabled = list.Count > 0,
            has_baseline = list.Any(check => check is BaselineCheck),
            checks_literal = RenderChecks(list),
        };
    }

    private static string RenderChecks(List<HardeningCheck> checks)
    {
        if (checks.Count == 0) return "[]";
        return "[" + string.Join(", ", checks.Select(RenderCheck)) + "]";
    }

    private static string RenderCheck(HardeningCheck check) => check switch
    {
        NoResultCheck => $$"""{"kind": {{PythonLiteral.Str("noResult")}}, "severity": {{PythonLiteral.Str(check.Severity.ToString())}}}""",
        // Issue #130: "field" is matched against a flat row's dict key or,
        // in container/API-tree mode, an element's tag name anywhere in the
        // output tree (see NullRateCheck's own doc comment on the "global
        // per field name" scoping decision). "threshold" is a plain 0.0-1.0
        // fraction, not a percentage — PythonLiteral.Num already renders the
        // shortest round-trippable form (0.3 -> "0.3", not "0.30" or
        // scientific notation).
        NullRateCheck nullRate => $$"""{"kind": {{PythonLiteral.Str("nullRate")}}, "severity": {{PythonLiteral.Str(check.Severity.ToString())}}, "field": {{PythonLiteral.Str(nullRate.FieldName)}}, "threshold": {{PythonLiteral.Num(nullRate.Threshold)}}}""",
        // Issue #131: "dropThreshold" is a plain 0.0-1.0 fraction of the
        // *previous* run's own result count (read from the sidecar file at
        // runtime, see the templates' _read_baseline) — there's no baseline
        // value to render here at all, since it doesn't exist yet at
        // generation time.
        BaselineCheck baseline => $$"""{"kind": {{PythonLiteral.Str("baseline")}}, "severity": {{PythonLiteral.Str(check.Severity.ToString())}}, "dropThreshold": {{PythonLiteral.Num(baseline.DropThreshold)}}}""",
        _ => throw new InvalidOperationException($"Unbekannter HardeningCheck-Typ: {check.GetType()}"),
    };
}
