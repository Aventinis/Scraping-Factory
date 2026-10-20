namespace ScrapingFactory.Compiler.IR;

// Issue #223: optional, mode- and engine-independent retry of a request
// that failed transiently — a connection error/timeout, or one of
// RetryOnStatusCodes (429/502/503/504 by default). Real targets routinely
// return such blips that succeed a few seconds later; without this, one of
// them aborts an entire scheduled run. Any other failure (404/401/403, ...)
// still fails immediately, and API mode's "404 = this combination doesn't
// exist, skip it" convention is untouched (404 isn't retryable by default).
//
// MaxAttempts counts the first try (3 = one try + two retries). Between
// attempts the script waits DelayMs — doubled after every retry when
// Exponential — or, for a 429/503 carrying a Retry-After header, exactly
// what the server asks for; every single wait is capped at MaxWaitMs. Each
// retry is announced on stdout, both so a scheduled run never degrades
// silently and so the companion's trial run can extend its deadline by the
// announced wait (PythonScriptVerifier). Once every attempt has failed, the
// run behaves exactly as it does without retries (Issue #223's own scope:
// abort, no "skip and continue").
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
