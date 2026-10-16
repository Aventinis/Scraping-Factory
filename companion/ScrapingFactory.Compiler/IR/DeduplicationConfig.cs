using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// Issue #225: opt-in deduplication of the generated script's output by one or
// more key field(s), mode-independent (Fields/Groups/Api-flat/Api-tree; not
// Combined's outer level, not Blocks). Two separable capabilities share this
// one config:
//   1. within-run (always on once this config exists): a row/element whose
//      key already appeared earlier in the SAME run is dropped — covers
//      overlapping pagination and the same item reachable from several start
//      URLs/categories. Stateless.
//   2. cross-run (Incremental): previously seen keys are tracked in a sidecar
//      file next to the output (see PythonDeduplicationLiteral), and only
//      genuinely new rows/elements are written — which changes the *meaning*
//      of the output file (a delta, or an ever-growing set), hence its own
//      explicit opt-in.
// KeyFields are matched by field/tag name like NullRateCheck/RequiredFieldsCheck
// already do for tree shapes (see PythonDeduplicationLiteral for what that
// means per shape).
public sealed class DeduplicationConfig
{
    public List<string> KeyFields { get; init; } = [];

    // Cross-run dedup. False = within-run only (no sidecar file at all).
    public bool Incremental { get; init; }

    // Only meaningful with Incremental: what the output file contains after a
    // run. Delta replaces it with just the new rows/elements; Append keeps
    // the previous file's rows and adds the new ones (flat shapes only — an
    // XML/tree-JSON document has no meaningful "append").
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public IncrementalOutputMode IncrementalOutput { get; init; } = IncrementalOutputMode.Delta;

    // Bounds the sidecar file's growth (only with Incremental).
    public DeduplicationRetention Retention { get; init; } = new();
}

public enum IncrementalOutputMode { Delta, Append }

public enum DeduplicationRetentionKind { MaxCount, MaxAge }

public sealed class DeduplicationRetention
{
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public DeduplicationRetentionKind Kind { get; init; } = DeduplicationRetentionKind.MaxCount;

    // Number of remembered keys (MaxCount) or number of days since a key was
    // last seen (MaxAge).
    public int Value { get; init; } = DefaultMaxCount;

    public const int DefaultMaxCount = 100_000;
}
