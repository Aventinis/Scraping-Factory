using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Builds the `hardening.*` Scriban context: checks_literal is a Python list-of-dicts (or "[]") that the templates'
// _run_hardening_checks dispatches on by "kind". has_baseline additionally gates the sidecar-file helpers and
// `import json`, since baseline is the only kind that keeps state between runs.
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
        // "field" is matched by dict key (flat) or tag name anywhere in the tree; "threshold" is a 0.0-1.0 fraction.
        NullRateCheck nullRate => $$"""{"kind": {{PythonLiteral.Str("nullRate")}}, "severity": {{PythonLiteral.Str(check.Severity.ToString())}}, "field": {{PythonLiteral.Str(nullRate.FieldName)}}, "threshold": {{PythonLiteral.Num(nullRate.Threshold)}}}""",
        // "dropThreshold" is a fraction of the previous run's count, which is read from the sidecar at run time.
        BaselineCheck baseline => $$"""{"kind": {{PythonLiteral.Str("baseline")}}, "severity": {{PythonLiteral.Str(check.Severity.ToString())}}, "dropThreshold": {{PythonLiteral.Num(baseline.DropThreshold)}}}""",
        // "minBodyLength" is an int literal or "None" (signal off); "blockPhrases" renders an empty list as "[]".
        BlockingCheck blocking => $$"""{"kind": {{PythonLiteral.Str("blocking")}}, "severity": {{PythonLiteral.Str(check.Severity.ToString())}}, "minBodyLength": {{(blocking.MinBodyLength is { } min ? min.ToString() : "None")}}, "blockPhrases": {{PythonLiteral.StrList(blocking.BlockPhrases ?? [])}}}""",
        // "fieldNames" is never empty (the validator rejects that).
        RequiredFieldsCheck requiredFields => $$"""{"kind": {{PythonLiteral.Str("requiredFields")}}, "severity": {{PythonLiteral.Str(check.Severity.ToString())}}, "fieldNames": {{PythonLiteral.StrList(requiredFields.FieldNames)}}}""",
        _ => throw new InvalidOperationException($"Unknown HardeningCheck type: {check.GetType()}"),
    };
}
