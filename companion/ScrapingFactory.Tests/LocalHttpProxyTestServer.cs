using System.Net;
using System.Net.Sockets;
using System.Text;

namespace ScrapingFactory.Tests;

// A minimal fake forward proxy for proxy-support e2e tests (Issue #88) —
// speaks just enough of plain (non-CONNECT) HTTP proxying for Python's
// requests library: a client configured with proxies={"http": ...} sends
// the absolute-form request line ("GET http://target/path HTTP/1.1")
// straight to this server instead of to the real target, which is exactly
// what lets a test prove a generated script actually routed a request
// through the configured proxy rather than connecting directly — the
// real target server's own content never reaches the client in that case,
// only this server's canned response does. Every received request line is
// recorded so a test can also assert *which* URL was asked for.
internal sealed class LocalHttpProxyTestServer : IDisposable
{
    private readonly TcpListener _listener;
    private readonly CancellationTokenSource _cts = new();
    private readonly List<string> _receivedRequestLines = [];
    private readonly Lock _lock = new();
    private readonly string _responseBody;

    public string Host => "127.0.0.1";
    public int Port { get; }
    public string BaseUrl => $"http://{Host}:{Port}";

    public IReadOnlyList<string> ReceivedRequestLines
    {
        get { lock (_lock) return [.. _receivedRequestLines]; }
    }

    public LocalHttpProxyTestServer(string responseBody)
    {
        _responseBody = responseBody;
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

        string? requestLine;
        try
        {
            requestLine = await reader.ReadLineAsync();
        }
        catch (Exception)
        {
            return;
        }
        if (requestLine is null)
            return;
        lock (_lock) _receivedRequestLines.Add(requestLine);

        // Drain the request headers — this fake proxy doesn't need any of
        // them, it always answers with the same canned body regardless of
        // what was actually asked for.
        string? headerLine;
        while (!string.IsNullOrEmpty(headerLine = await reader.ReadLineAsync()))
        {
        }

        var bodyBytes = Encoding.UTF8.GetBytes(_responseBody);
        await using var writer = new StreamWriter(stream, Encoding.ASCII) { NewLine = "\r\n" };
        await writer.WriteLineAsync("HTTP/1.1 200 OK");
        await writer.WriteLineAsync("Content-Type: text/html; charset=utf-8");
        await writer.WriteLineAsync($"Content-Length: {bodyBytes.Length}");
        await writer.WriteLineAsync("Connection: close");
        await writer.WriteLineAsync();
        await writer.FlushAsync();
        await stream.WriteAsync(bodyBytes);
        await stream.FlushAsync();
    }

    public void Dispose()
    {
        _cts.Cancel();
        _listener.Stop();
    }
}
