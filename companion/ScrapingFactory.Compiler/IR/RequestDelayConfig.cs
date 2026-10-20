namespace ScrapingFactory.Compiler.IR;

// Issue #222: optional, mode- and engine-independent pacing of the generated
// script's outbound requests — the most common reason an unthrottled scraper
// (pagination, several start URLs, an API parameter cartesian product) gets
// rate-limited or blocked. Distinct from Proxy (#88, spreads load across
// IPs, not across time) and Hardening (#129-#133, only detects a block after
// the fact).
//
// Semantics are a *minimum gap between the starts of two consecutive
// requests*: before each request, a pause is drawn uniformly from
// [MinMs, MaxMs] (MinMs == MaxMs for a fixed pause), and only whatever part
// of it hasn't already elapsed since the previous request started is
// actually slept — processing time counts toward the gap, so the script is
// never slower than it needs to be. The very first request of a run starts
// immediately. See _pace_request in the Python templates for the runtime,
// and PythonScriptVerifier for how the trial run keeps these pauses from
// ever counting against its own timeout.
public sealed class RequestDelayConfig
{
    public int MinMs { get; init; }
    public int MaxMs { get; init; }

    // Per pause, not per run — a single pause longer than a minute is almost
    // certainly a typo (seconds entered as milliseconds or the like).
    public const int MaxAllowedMs = 60_000;
}
