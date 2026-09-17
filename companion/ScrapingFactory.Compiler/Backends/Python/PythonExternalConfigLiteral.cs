namespace ScrapingFactory.Compiler.Backends.Python;

// Issue #178: builds the single Scriban context object every one of the six
// templates renders `external_config.*` from — just an `enabled` flag, unlike
// PythonProxyLiteral/PythonChangeDetectionLiteral, since there's nothing else
// to configure server-side. Everything else (which values are editable, the
// XML schema, self-bootstrapping, validation) lives entirely in the runtime
// template code — the companion's only job here is telling each template
// whether to emit that code at all.
internal static class PythonExternalConfigLiteral
{
    public static object BuildContext(bool enabled) => new { enabled };
}
