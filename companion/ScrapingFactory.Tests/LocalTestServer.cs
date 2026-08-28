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
    private readonly Func<HttpListenerRequest, LocalTestServerResponse> _responder;
    private readonly CancellationTokenSource _cts = new();

    public string BaseUrl { get; }

    public LocalTestServer(string html, HttpStatusCode statusCode = HttpStatusCode.OK)
        : this(_ => new LocalTestServerResponse(html, "text/html; charset=utf-8", statusCode))
    {
    }

    // API-Mode tests need a response that varies per request (e.g. a
    // discovery endpoint returning a different body than the main endpoint,
    // or a body that depends on query parameters) — a single canned string
    // like the constructor above serves isn't enough there.
    public LocalTestServer(Func<HttpListenerRequest, LocalTestServerResponse> responder)
    {
        _responder = responder;
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

            var response = _responder(ctx.Request);
            var bytes = Encoding.UTF8.GetBytes(response.Body);
            ctx.Response.StatusCode = (int)response.StatusCode;
            ctx.Response.ContentType = response.ContentType;
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

internal sealed record LocalTestServerResponse(string Body, string ContentType, HttpStatusCode StatusCode = HttpStatusCode.OK);
