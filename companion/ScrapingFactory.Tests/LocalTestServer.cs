using System.Net;
using System.Net.Sockets;
using System.Text;

namespace ScrapingFactory.Tests;

// Serves canned HTML on a real loopback port so tests can point a generated
// script's `requests.get(url)` (an actual out-of-process Python subprocess,
// entirely outside .NET's HttpClient mocking) at something real without
// depending on the internet.
internal sealed class LocalTestServer : IDisposable
{
    private readonly HttpListener _listener = new();
    private readonly string _html;
    private readonly HttpStatusCode _statusCode;
    private readonly CancellationTokenSource _cts = new();

    public string BaseUrl { get; }

    public LocalTestServer(string html, HttpStatusCode statusCode = HttpStatusCode.OK)
    {
        _html = html;
        _statusCode = statusCode;
        var port = GetFreePort();
        BaseUrl = $"http://127.0.0.1:{port}/";
        _listener.Prefixes.Add(BaseUrl);
        _listener.Start();
        _ = Task.Run(ListenLoopAsync);
    }

    private async Task ListenLoopAsync()
    {
        while (!_cts.IsCancellationRequested)
        {
            HttpListenerContext ctx;
            try
            {
                ctx = await _listener.GetContextAsync();
            }
            catch (Exception)
            {
                return; // listener stopped/disposed
            }

            var bytes = Encoding.UTF8.GetBytes(_html);
            ctx.Response.StatusCode = (int)_statusCode;
            ctx.Response.ContentType = "text/html; charset=utf-8";
            ctx.Response.ContentLength64 = bytes.Length;
            await ctx.Response.OutputStream.WriteAsync(bytes);
            ctx.Response.OutputStream.Close();
        }
    }

    private static int GetFreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    public void Dispose()
    {
        _cts.Cancel();
        _listener.Stop();
        _listener.Close();
    }
}
