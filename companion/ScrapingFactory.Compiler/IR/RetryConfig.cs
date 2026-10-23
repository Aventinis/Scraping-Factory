namespace ScrapingFactory.Compiler.IR;

// Retries a request that failed transiently (a connection error, a timeout, or one of RetryOnStatusCodes).
// Other failures (404, 401, …) fail at once; API mode's "404 = skip this combination" is unchanged. MaxAttempts
// counts the first try. The wait is DelayMs, doubled per retry when Exponential, or exactly a 429/503's
// Retry-After; each wait is capped at MaxWaitMs. Every retry is announced on stdout (the trial run extends its
// deadline by it). When all attempts fail the run behaves as without retries.
public sealed class RetryConfig
{
    public int MaxAttempts { get; init; } = 3;
    public int DelayMs { get; init; } = 2000;
    public bool Exponential { get; init; } = true;
    public List<int>? RetryOnStatusCodes { get; init; }

    public const int MinAllowedAttempts = 2;
    public const int MaxAllowedAttempts = 10;
    public const int MaxWaitMs = 60_000;
    public static readonly IReadOnlyList<int> DefaultRetryOnStatusCodes = [429, 502, 503, 504];

    public IReadOnlyList<int> EffectiveStatusCodes => RetryOnStatusCodes is { Count: > 0 } codes ? codes : DefaultRetryOnStatusCodes;
}
