using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Issue #88: builds the single Scriban context object every one of the six
// templates renders `proxy.*` from — env_var_literal is either a Python
// string literal (the env var *name*, never a value — see ProxyConfig's own
// doc comment) or the literal "None" when proxying isn't configured.
internal static class PythonProxyLiteral
{
    public static object BuildContext(ProxyConfig? proxy) => proxy is null
        ? new { enabled = false, env_var_literal = "None" }
        : new { enabled = true, env_var_literal = PythonLiteral.Str(proxy.EnvironmentVariableName) };
}
