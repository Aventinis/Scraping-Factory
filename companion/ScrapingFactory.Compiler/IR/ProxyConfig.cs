namespace ScrapingFactory.Compiler.IR;

// Issue #88: optional, mode-independent (Fields/Groups/Api alike) opt-in —
// lets the user route the generated script's outbound requests through
// proxies they already have access to (e.g. from their employer or ISP).
// EnvironmentVariableName is the *name* of an environment variable holding
// a comma-separated list of proxy URLs, never a literal value baked into
// the script — same "read at runtime via os.environ[...]" pattern
// FillAction.EnvironmentVariableName and ApiHeader.EnvironmentVariableName
// already use. If more than one proxy is present in the list, the
// generated script rotates between them (round-robin) per request/run.
public sealed class ProxyConfig
{
    public required string EnvironmentVariableName { get; init; }
}
