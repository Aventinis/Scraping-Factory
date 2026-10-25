namespace ScrapingFactory.Compiler.IR;

// The script checks every request it is about to make against the target's robots.txt Disallow/Allow rules at
// run time (a site may change its file after the script was generated).
public sealed class RobotsDisallowConfig
{
    // Skip is the default: the least surprising reaction.
    public RobotsDisallowAction Action { get; init; } = RobotsDisallowAction.Skip;
}

public enum RobotsDisallowAction
{
    // Report, request it anyway.
    Warn,

    // Report, skip this request, continue.
    Skip,

    // Report and exit with a dedicated exit code.
    Abort,
}
