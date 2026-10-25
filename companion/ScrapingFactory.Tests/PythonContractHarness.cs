using System.Diagnostics;
using System.Text.Json;

namespace ScrapingFactory.Tests;

// Issue #388: runs a snippet of Python against a REAL generated script, imported as a module (its
// main() is behind the __main__ guard), so a contract vector exercises the helper that actually ships
// in the script instead of a copy of it. The snippet sees `mod` (the generated module) and `data` (the
// input, parsed from JSON) and must assign `result`; the harness prints it as JSON.
internal static class PythonContractHarness
{
    private const string Preamble = """
        import importlib.util, json, sys
        _spec = importlib.util.spec_from_file_location("sf_generated", "mod.py")
        mod = importlib.util.module_from_spec(_spec)
        _spec.loader.exec_module(mod)
        with open("input.json", encoding="utf-8") as _f:
            data = json.load(_f)

        """;

    private const string Epilogue = """

        sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))
        """;

    public static async Task<JsonElement> RunAsync(string generatedScript, string snippet, object input)
    {
        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-contract-").FullName;
        try
        {
            await File.WriteAllTextAsync(Path.Combine(workDir, "mod.py"), generatedScript);
            await File.WriteAllTextAsync(Path.Combine(workDir, "input.json"), JsonSerializer.Serialize(input));
            await File.WriteAllTextAsync(Path.Combine(workDir, "harness.py"), Preamble + snippet + Epilogue);

            Exception? lastError = null;
            foreach (var candidate in new[] { "python3", "python" })
            {
                try
                {
                    var psi = new ProcessStartInfo(candidate, "harness.py")
                    {
                        WorkingDirectory = workDir,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        StandardOutputEncoding = System.Text.Encoding.UTF8,
                        UseShellExecute = false,
                    };
                    psi.Environment["PYTHONIOENCODING"] = "utf-8";
                    using var process = Process.Start(psi)!;
                    var stdout = await process.StandardOutput.ReadToEndAsync();
                    var stderr = await process.StandardError.ReadToEndAsync();
                    await process.WaitForExitAsync();
                    if (process.ExitCode != 0)
                        throw new InvalidOperationException($"Contract harness failed (exit {process.ExitCode}):{Environment.NewLine}{stderr}");
                    using var document = JsonDocument.Parse(stdout);
                    return document.RootElement.Clone();
                }
                catch (System.ComponentModel.Win32Exception ex)
                {
                    lastError = ex;
                }
            }
            throw new InvalidOperationException("No Python interpreter found (tried: python3, python).", lastError);
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }
}
