namespace ScrapingFactory.Compiler.Backends.Python;

// Issue #219: builds the single Scriban context object every one of the
// four flat/group-mode templates renders `preflight.*` from — just an
// `enabled` flag, mirroring PythonExternalConfigLiteral exactly, since
// there's nothing else to configure server-side. Which ETag/Last-Modified
// value counts as "changed" is tracked entirely by the generated script's
// own sidecar file, read/written at runtime — the companion's only job
// here is telling each template whether to emit the preflight-check code
// at all.
internal static class PythonPreflightLiteral
{
    public static object BuildContext(bool enabled) => new { enabled };
}
