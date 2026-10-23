namespace ScrapingFactory.Compiler.IR;

// Routes the script's requests through the user's own proxies. EnvironmentVariableName names a variable holding a
// comma-separated list of proxy URLs (never a literal address); several are rotated round-robin.
public sealed class ProxyConfig
{
    public required string EnvironmentVariableName { get; init; }
}
