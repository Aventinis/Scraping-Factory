using System.Net;
using ScrapingFactory.Companion.Verification;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class ScrapingVerifierTests
{
    private static ScrapingVerifier VerifierReturning(string html, HttpStatusCode statusCode = HttpStatusCode.OK)
    {
        var httpClient = new HttpClient(FakeHttpMessageHandler.ReturningHtml(html, statusCode))
        {
            BaseAddress = new Uri("http://unused.invalid"),
        };
        return new ScrapingVerifier(httpClient);
    }

    [Fact]
    public async Task AllSelectorsMatch_Succeeds()
    {
        var verifier = VerifierReturning("<html><body><h1>Titel</h1><span class='price'>9,99€</span></body></html>");
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields =
            [
                new ScrapingField { Name = "Titel", Selector = "h1" },
                new ScrapingField { Name = "Preis", Selector = ".price" },
            ],
        };

        var result = await verifier.VerifyAsync(config);

        Assert.True(result.Success);
        Assert.Null(result.Error);
        Assert.Equal(2, result.Fields.Count);
        Assert.All(result.Fields, f => Assert.True(f.Success));
    }

    [Fact]
    public async Task SelectorMatchingNothing_FailsAndReportsMatchCountZero()
    {
        var verifier = VerifierReturning("<html><body><h1>Titel</h1></body></html>");
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields = [new ScrapingField { Name = "Preis", Selector = ".price" }],
        };

        var result = await verifier.VerifyAsync(config);

        Assert.False(result.Success);
        var field = Assert.Single(result.Fields);
        Assert.Equal("Preis", field.Name);
        Assert.Equal(".price", field.Selector);
        Assert.Equal(0, field.MatchCount);
        Assert.False(field.Success);
    }

    [Fact]
    public async Task MixOfMatchingAndNonMatchingFields_ReportsEachIndividually()
    {
        var verifier = VerifierReturning("<html><body><h1>Titel</h1></body></html>");
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields =
            [
                new ScrapingField { Name = "Titel", Selector = "h1" },
                new ScrapingField { Name = "Preis", Selector = ".price" },
            ],
        };

        var result = await verifier.VerifyAsync(config);

        Assert.False(result.Success);
        Assert.Equal(2, result.Fields.Count);
        Assert.True(result.Fields.Single(f => f.Name == "Titel").Success);
        Assert.False(result.Fields.Single(f => f.Name == "Preis").Success);
    }

    [Fact]
    public async Task MatchCountReflectsNumberOfElements()
    {
        var verifier = VerifierReturning("<html><body><li>A</li><li>B</li><li>C</li></body></html>");
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields = [new ScrapingField { Name = "Items", Selector = "li" }],
        };

        var result = await verifier.VerifyAsync(config);

        Assert.Equal(3, result.Fields.Single().MatchCount);
    }

    [Fact]
    public async Task NonSuccessStatusCode_FailsWithError()
    {
        var verifier = VerifierReturning("not found", HttpStatusCode.NotFound);
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
        };

        var result = await verifier.VerifyAsync(config);

        Assert.False(result.Success);
        Assert.NotNull(result.Error);
        Assert.Contains("404", result.Error);
        Assert.Empty(result.Fields);
    }

    [Fact]
    public async Task NetworkFailure_FailsWithError()
    {
        var httpClient = new HttpClient(FakeHttpMessageHandler.Throwing(new HttpRequestException("Connection refused")))
        {
            BaseAddress = new Uri("http://unused.invalid"),
        };
        var verifier = new ScrapingVerifier(httpClient);
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
        };

        var result = await verifier.VerifyAsync(config);

        Assert.False(result.Success);
        Assert.NotNull(result.Error);
        Assert.Contains("Connection refused", result.Error);
        Assert.Empty(result.Fields);
    }

    [Fact]
    public async Task InvalidSelector_CountsAsZeroMatchesInsteadOfThrowing()
    {
        // A malformed selector (unclosed attribute bracket) should degrade
        // to "no match" rather than crashing the whole verification with an
        // unrelated 500 — the field-level "0 matches" report is more useful
        // to a user than an opaque server error either way.
        var verifier = VerifierReturning("<html><body><h1>Titel</h1></body></html>");
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields = [new ScrapingField { Name = "Bad", Selector = "h1[unclosed" }],
        };

        var result = await verifier.VerifyAsync(config);

        Assert.False(result.Success);
        Assert.Equal(0, result.Fields.Single().MatchCount);
    }
}
