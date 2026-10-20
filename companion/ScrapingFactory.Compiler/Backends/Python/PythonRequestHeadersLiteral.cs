using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Issue #226: builds the Scriban context object every DOM-mode template
// renders `request_headers.*` from — `enabled`, `has_env` (some header reads an
// environment variable, so the script needs os/sys and the `_require_env`
// helper) and the header list as a Python literal. The entries reuse the API
// mode's `{"name", "value"|"envVar"}` shape (PythonApiConfigLiteral.RenderHeaders),
// so a credential is never written into the script as a literal.
internal static class PythonRequestHeadersLiteral
{
    public static object BuildContext(List<ApiHeader>? headers)
    {
        var any = headers is { Count: > 0 };
        return new
        {
            enabled = any,
            has_env = any && headers!.Any(header => !string.IsNullOrWhiteSpace(header.EnvironmentVariableName)),
            headers_literal = PythonApiConfigLiteral.RenderHeaders(headers),
        };
    }

    // Used by the Browser-engine generator to fold the env-var needs into its
    // own needs_os_import / needs_exit_helper flags.
    public static bool UsesEnvironmentVariables(List<ApiHeader>? headers) =>
        headers?.Any(header => !string.IsNullOrWhiteSpace(header.EnvironmentVariableName)) == true;
}
