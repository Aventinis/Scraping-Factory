namespace ScrapingFactory.Compiler.IR;

// Paces the script's outbound requests (the usual cause of rate limits and blocks). A minimum gap between the
// starts of two consecutive requests, drawn uniformly from [MinMs, MaxMs] (equal = fixed); time already spent
// counts toward it and the first request is not delayed. The trial run does not count these pauses against its
// timeout (PythonScriptVerifier).
public sealed class RequestDelayConfig
{
    public int MinMs { get; init; }
    public int MaxMs { get; init; }

    // Per pause; anything longer is almost certainly a unit typo.
    public const int MaxAllowedMs = 60_000;
}
