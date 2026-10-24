using System.Diagnostics;

namespace ScrapingFactory.Tests;

// What a generated script printed and exited with. `Output` is the content of the output file asked for with
// RunScriptTextAsync (empty when the script did not write it). The Deconstruct overloads keep the call sites short:
// (exit, stderr), (exit, stdout, stderr) and (exit, stdout, stderr, output).
internal sealed record ScriptResult(int ExitCode, string Stdout, string Stderr, string Output = "")
{
    public void Deconstruct(out int exitCode, out string stderr)
    {
        exitCode = ExitCode;
        stderr = Stderr;
    }

    public void Deconstruct(out int exitCode, out string stdout, out string stderr)
    {
        exitCode = ExitCode;
        stdout = Stdout;
        stderr = Stderr;
    }

    public void Deconstruct(out int exitCode, out string stdout, out string stderr, out string output)
    {
        exitCode = ExitCode;
        stdout = Stdout;
        stderr = Stderr;
        output = Output;
    }
}

// Runs a generated Python script the way the trial run does (python3, else python) and collects its exit code and output.
// The end-to-end tests share this instead of each carrying their own process code.
internal static class ScriptRunner
{
    public static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(30);

    // `env` entries are added to the script's environment; `timeout` defaults to DefaultTimeout.
    public static async Task<ScriptResult> RunAsync(
        string scriptPath, string workDir, IReadOnlyDictionary<string, string>? env = null, TimeSpan? timeout = null)
    {
        Exception? lastError = null;
        foreach (var candidate in new[] { "python3", "python" })
        {
            var psi = new ProcessStartInfo
            {
                FileName = candidate,
                WorkingDirectory = workDir,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add(scriptPath);
            if (env is not null)
            {
                foreach (var (name, value) in env)
                    psi.Environment[name] = value;
            }

            try
            {
                using var process = new Process { StartInfo = psi };
                process.Start();
                var stderrTask = process.StandardError.ReadToEndAsync();
                var stdoutTask = process.StandardOutput.ReadToEndAsync();
                using var cts = new CancellationTokenSource(timeout ?? DefaultTimeout);
                await process.WaitForExitAsync(cts.Token);
                return new ScriptResult(process.ExitCode, await stdoutTask, await stderrTask);
            }
            catch (System.ComponentModel.Win32Exception ex)
            {
                lastError = ex; // executable not found — try the next candidate
            }
        }
        throw new InvalidOperationException("No Python interpreter found (tried: python3, python).", lastError);
    }

    // Writes `script` into a fresh temp directory, runs it there, reads `outputFileName` if given and removes the directory again.
    public static async Task<ScriptResult> RunScriptTextAsync(
        string script, IReadOnlyDictionary<string, string>? env = null, string? outputFileName = null, TimeSpan? timeout = null)
    {
        var workDir = Directory.CreateTempSubdirectory("scrapingfactory-script-").FullName;
        try
        {
            var scriptPath = Path.Combine(workDir, "scraper.py");
            await File.WriteAllTextAsync(scriptPath, script);
            var result = await RunAsync(scriptPath, workDir, env, timeout);
            var outputPath = outputFileName is null ? null : Path.Combine(workDir, outputFileName);
            var output = outputPath is not null && File.Exists(outputPath) ? await File.ReadAllTextAsync(outputPath) : "";
            return result with { Output = output };
        }
        finally
        {
            Directory.Delete(workDir, recursive: true);
        }
    }
}
