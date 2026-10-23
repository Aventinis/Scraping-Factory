using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends;

// When /generate skips the trial run instead of executing the script. A skip returns the generated (and structurally
// validated) script with a synthetic success result, and the reason in a response header.
public static class VerificationPolicy
{
    // Plain English text, ASCII only: Kestrel refuses to send a header value with other characters.
    public const string SkippedHeader = "X-ScrapingFactory-Verification-Skipped";

    // Caps the *estimate* (VerificationTimeEstimator), not the run: a safety valve so one absurd configuration cannot tie
    // up the companion. Not a CompanionBackendOverrides knob, since a slower machine is no reason to raise it.
    public static readonly TimeSpan TimeoutCap = TimeSpan.FromMinutes(10);

    // A skip the caller asked for (Settings > "Skip the trial run") is reported before the automatic cap.
    public static string? SkipReason(ScrapingConfig config, long extraTimeoutMs) =>
        config.SkipVerification == true
            ? "Verification was skipped because it is disabled in Settings - the generated script was not run against the live page. " +
              "Run it yourself to check that it works."
            : CheckTimeoutCap(extraTimeoutMs);

    public static string? CheckTimeoutCap(long extraTimeoutMs)
    {
        var extra = TimeSpan.FromMilliseconds(extraTimeoutMs);
        if (extra <= TimeoutCap)
            return null;
        return $"Estimated extra verification time ({extra:hh\\:mm\\:ss}) exceeds the {TimeoutCap:hh\\:mm\\:ss} cap for a " +
               "/generate trial run - the generated script was returned without being run against the live page first. Test it " +
               "manually before relying on it.";
    }
}
