namespace ScrapingFactory.Companion.Verification;

public sealed class FieldVerificationResult
{
    public required string Name { get; init; }
    public required string Selector { get; init; }
    public int MatchCount { get; init; }
    public bool Success => MatchCount > 0;
}

public sealed class VerificationResult
{
    public bool Success { get; init; }

    // Set when the page itself couldn't be fetched/parsed at all (network
    // error, non-2xx status) — Fields is empty in that case, since no
    // selector could be checked against anything.
    public string? Error { get; init; }

    public List<FieldVerificationResult> Fields { get; init; } = [];
}
