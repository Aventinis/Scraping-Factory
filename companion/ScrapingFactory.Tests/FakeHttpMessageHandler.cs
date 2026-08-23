using System.Net;

namespace ScrapingFactory.Tests;

// Lets tests stub outbound HttpClient calls (e.g. ScrapingVerifier fetching
// the target page) without touching the network.
internal sealed class FakeHttpMessageHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
{
    public static FakeHttpMessageHandler ReturningHtml(string html, HttpStatusCode statusCode = HttpStatusCode.OK) =>
        new(_ => new HttpResponseMessage(statusCode) { Content = new StringContent(html) });

    public static FakeHttpMessageHandler Throwing(Exception exception) =>
        new(_ => throw exception);

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
        Task.FromResult(respond(request));
}
