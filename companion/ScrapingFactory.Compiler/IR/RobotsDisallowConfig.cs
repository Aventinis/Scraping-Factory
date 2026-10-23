namespace ScrapingFactory.Compiler.IR;

// Issue #333: opt-in — the generated script reads the target's robots.txt at
// run time and checks every request it is about to make against the
// Disallow/Allow rules for its user agent. The extension's "Check robots.txt"
// (#18) is advisory and runs once at configuration time; a site may change
// its robots.txt after the script was generated, which a scheduled script
// would never notice. Mode-independent (Fields/Groups/Api/Blocks alike);
// null is today's exact behavior (no check).
public sealed class RobotsDisallowConfig
{
    // What to do with a request whose path is disallowed. Skip is the
    // default: the least surprising reaction (don't make the request, carry
    // on with the rest) — Warn only reports, Abort stops the run.
    public RobotsDisallowAction Action { get; init; } = RobotsDisallowAction.Skip;
}

public enum RobotsDisallowAction
{
    // Print a warning, make the request anyway.
    Warn,

    // Print a notice, don't make this request, continue with the rest.
    Skip,

    // Print an error and exit with a dedicated exit code.
    Abort,
}
