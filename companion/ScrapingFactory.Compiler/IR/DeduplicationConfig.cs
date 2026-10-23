using System.Text.Json.Serialization;

namespace ScrapingFactory.Compiler.IR;

// Drops duplicate rows/elements by key. Fields/Groups/Api; not Blocks or Combined's outer level. Two parts:
// within-run (always, once configured) and cross-run (Incremental: remembered keys in a sidecar file, only new
// items are written). KeyFields are matched by field/tag name, like NullRateCheck.
public sealed class DeduplicationConfig
{
    public List<string> KeyFields { get; init; } = [];

    // Cross-run; false = within-run only (no sidecar).
    public bool Incremental { get; init; }

    // With Incremental: Delta replaces the file with the new items, Append adds them to the previous content.
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public IncrementalOutputMode IncrementalOutput { get; init; } = IncrementalOutputMode.Delta;

    // Bounds the sidecar's growth.
    public DeduplicationRetention Retention { get; init; } = new();
}

public enum IncrementalOutputMode { Delta, Append }

public enum DeduplicationRetentionKind { MaxCount, MaxAge }

public sealed class DeduplicationRetention
{
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public DeduplicationRetentionKind Kind { get; init; } = DeduplicationRetentionKind.MaxCount;

    // Remembered keys (MaxCount) or days since a key was last seen (MaxAge).
    public int Value { get; init; } = DefaultMaxCount;

    public const int DefaultMaxCount = 100_000;
}
