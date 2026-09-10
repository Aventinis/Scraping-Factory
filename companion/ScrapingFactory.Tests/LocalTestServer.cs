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
    // Parallel test classes each pick a "free" port via GetFreePort(), but
    // that check and the later HttpListener.Start() below aren't atomic —
    // another instance can grab the same port in between (TOCTOU race),
    // which surfaces as "Address already in use" either here or, more
    // confusingly, from a since-unrelated instance's later Dispose(). Retry
    // with a fresh port instead of letting that flakiness fail the test.
    private const int MaxStartAttempts = 5;

    private readonly HttpListener _listener;
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

        for (var attempt = 1; ; attempt++)
        {
            var port = GetFreePort();
            var baseUrl = $"http://127.0.0.1:{port}/";
            var listener = new HttpListener();
            listener.Prefixes.Add(baseUrl);
            try
            {
                listener.Start();
                _listener = listener;
                BaseUrl = baseUrl;
                break;
            }
            catch (HttpListenerException) when (attempt < MaxStartAttempts)
            {
                listener.Close();
            }
        }

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
        try
        {
            _listener.Stop();
            _listener.Close();
        }
        catch (HttpListenerException)
        {
            // Cleanup-time port bookkeeping can race with another
            // LocalTestServer instance under parallel test execution (see
            // the comment on MaxStartAttempts above) — by this point the
            // test itself has already run to completion, so a failure here
            // must not fail the test.
        }
    }
}

internal sealed record LocalTestServerResponse(string Body, string ContentType, HttpStatusCode StatusCode = HttpStatusCode.OK);
