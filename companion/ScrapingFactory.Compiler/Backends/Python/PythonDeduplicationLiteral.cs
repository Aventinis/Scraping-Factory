using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Issue #225: builds the single Scriban context object every non-Blocks
// template renders `dedup.*` from. The runtime helper code itself lives in
// language-modules/python/templates/fragments/dedup_{common,flat,tree}.py.j2
// and is spliced into the templates by `#@include` (Issue #326); this class
// only supplies the values those fragments render: the flags the templates
// branch on, and the configuration as ready-made Python literals.
internal static class PythonDeduplicationLiteral
{
    public static object BuildContext(DeduplicationConfig? dedup)
    {
        if (dedup is null)
        {
            return new
            {
                enabled = false, incremental = false, append = false,
                key_fields_literal = "[]", incremental_literal = "False", append_literal = "False",
                retention_kind_literal = PythonLiteral.Str(nameof(DeduplicationRetentionKind.MaxCount)),
                retention_value = DeduplicationRetention.DefaultMaxCount,
            };
        }

        var append = dedup.Incremental && dedup.IncrementalOutput == IncrementalOutputMode.Append;
        return new
        {
            enabled = true, incremental = dedup.Incremental, append,
            key_fields_literal = PythonLiteral.StrList(dedup.KeyFields),
            incremental_literal = dedup.Incremental ? "True" : "False",
            append_literal = append ? "True" : "False",
            retention_kind_literal = PythonLiteral.Str(dedup.Retention.Kind.ToString()),
            retention_value = dedup.Retention.Value,
        };
    }
}
