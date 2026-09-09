using System.Net;
using System.Net.Sockets;
using System.Text;

namespace ScrapingFactory.Tests;

// A minimal fake SMTP server for change-detection e2e tests (Issue #87) —
// speaks just enough of RFC 5321 for Python's own smtplib to complete a
// real send: greeting, EHLO (single-line 250 response, deliberately never
// advertising STARTTLS — see _notify_email's own "upgrade only if offered"
// doc comment in the generated templates), MAIL FROM/RCPT TO/DATA/QUIT.
// No AUTH support either, since the e2e tests exercise the auth-less-relay
// path (SmtpUsernameEnvVar/SmtpPasswordEnvVar left unset). No TLS: skipping
// STARTTLS advertisement is what keeps this server simple, mirroring a real
// unauthenticated internal/local relay rather than a public provider.
internal sealed class LocalSmtpTestServer : IDisposable
{
    private readonly TcpListener _listener;
    private readonly CancellationTokenSource _cts = new();
    private readonly List<string> _receivedMessages = [];
    private readonly Lock _lock = new();

    public string Host => "127.0.0.1";
    public int Port { get; }

    public IReadOnlyList<string> ReceivedMessages
    {
        get { lock (_lock) return [.. _receivedMessages]; }
    }

    public LocalSmtpTestServer()
    {
        _listener = new TcpListener(IPAddress.Loopback, 0);
        _listener.Start();
        Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        _ = Task.Run(AcceptLoopAsync);
    }

    private async Task AcceptLoopAsync()
    {
        while (!_cts.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await _listener.AcceptTcpClientAsync(_cts.Token);
            }
            catch (Exception)
            {
                return; // listener stopped/disposed
            }
            _ = Task.Run(() => HandleClientAsync(client));
        }
    }

    private async Task HandleClientAsync(TcpClient client)
    {
        using var _ = client;
        using var stream = client.GetStream();
        using var reader = new StreamReader(stream, Encoding.ASCII);
        var writer = new StreamWriter(stream, Encoding.ASCII) { NewLine = "\r\n", AutoFlush = true };

        await writer.WriteLineAsync("220 localhost SMTP test server ready");

        var dataLines = new List<string>();
        var inData = false;
        while (true)
        {
            string? line;
            try
            {
                line = await reader.ReadLineAsync();
            }
            catch (Exception)
            {
                return;
            }
            if (line is null)
                return;

            if (inData)
            {
                if (line == ".")
                {
                    inData = false;
                    lock (_lock) _receivedMessages.Add(string.Join("\n", dataLines));
                    dataLines.Clear();
                    await writer.WriteLineAsync("250 OK: message queued");
                    continue;
                }
                dataLines.Add(line);
                continue;
            }

            var upper = line.ToUpperInvariant();
            if (upper.StartsWith("DATA"))
            {
                inData = true;
                await writer.WriteLineAsync("354 Start mail input; end with <CRLF>.<CRLF>");
            }
            else if (upper.StartsWith("QUIT"))
            {
                await writer.WriteLineAsync("221 Bye");
                return;
            }
            else
            {
                // EHLO/HELO/MAIL FROM/RCPT TO all just get a plain "250 OK" —
                // a single-line EHLO response means smtplib's has_extn(...)
                // finds nothing, so the generated script's opportunistic
                // STARTTLS upgrade is correctly skipped.
                await writer.WriteLineAsync("250 OK");
            }
        }
    }

    public void Dispose()
    {
        _cts.Cancel();
        _listener.Stop();
    }
}
