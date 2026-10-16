using System.Text.Json;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #225: wire-format round trip of DeduplicationConfig, using the same
// web-default camelCase options the real /generate endpoint binds with.
public class DeduplicationConfigJsonTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    [Fact]
    public void Deserialize_FullConfig_MapsEveryProperty()
    {
        const string json = """
            {
              "keyFields": ["Titel", "Preis"],
              "incremental": true,
              "incrementalOutput": "Append",
              "retention": { "kind": "MaxAge", "value": 30 }
            }
            """;

        var dedup = JsonSerializer.Deserialize<DeduplicationConfig>(json, Web)!;

        Assert.Equal(["Titel", "Preis"], dedup.KeyFields);
        Assert.True(dedup.Incremental);
        Assert.Equal(IncrementalOutputMode.Append, dedup.IncrementalOutput);
        Assert.Equal(DeduplicationRetentionKind.MaxAge, dedup.Retention.Kind);
        Assert.Equal(30, dedup.Retention.Value);
    }

    [Fact]
    public void Deserialize_MinimalConfig_UsesDocumentedDefaults()
    {
        var dedup = JsonSerializer.Deserialize<DeduplicationConfig>("""{ "keyFields": ["Id"] }""", Web)!;

        Assert.False(dedup.Incremental);
        Assert.Equal(IncrementalOutputMode.Delta, dedup.IncrementalOutput);
        Assert.Equal(DeduplicationRetentionKind.MaxCount, dedup.Retention.Kind);
        Assert.Equal(DeduplicationRetention.DefaultMaxCount, dedup.Retention.Value);
    }

    [Fact]
    public void ScrapingConfig_WithoutDeduplication_LeavesItNull()
    {
        var config = JsonSerializer.Deserialize<ScrapingConfig>("""{ "url": "https://example.com", "fields": [] }""", Web)!;
        Assert.Null(config.Deduplication);
    }
}
