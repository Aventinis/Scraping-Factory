using AngleSharp;
using AngleSharp.Dom;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Companion.Verification;

// Checks a ScrapingConfig against the live page before /generate hands out a
// script for it — same rendering stage as the generated script (static
// HTML only, no JS execution), per the Konsistenzregel in CLAUDE.md, so a
// script that verifies here behaves identically once downloaded and run.
public sealed class ScrapingVerifier(HttpClient httpClient)
{
    public async Task<VerificationResult> VerifyAsync(ScrapingConfig config, CancellationToken ct = default)
    {
        string html;
        try
        {
            var response = await httpClient.GetAsync(config.Url, ct);
            if (!response.IsSuccessStatusCode)
            {
                return new VerificationResult
                {
                    Success = false,
                    Error = $"Seite antwortete mit HTTP {(int)response.StatusCode} ({response.ReasonPhrase}).",
                };
            }
            html = await response.Content.ReadAsStringAsync(ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return new VerificationResult { Success = false, Error = $"Seite nicht erreichbar: {ex.Message}" };
        }

        var context = BrowsingContext.New(Configuration.Default);
        IDocument document;
        try
        {
            document = await context.OpenAsync(req => req.Content(html).Address(config.Url), ct);
        }
        catch (Exception ex)
        {
            return new VerificationResult { Success = false, Error = $"Seite konnte nicht geparst werden: {ex.Message}" };
        }

        var fields = config.Fields
            .Select(field => new FieldVerificationResult
            {
                Name = field.Name,
                Selector = field.Selector,
                MatchCount = CountMatches(document, field.Selector),
            })
            .ToList();

        return new VerificationResult
        {
            Success = fields.All(f => f.Success),
            Fields = fields,
        };
    }

    // An invalid/unsupported selector (e.g. :contains(), not valid CSS)
    // counts as zero matches rather than crashing the whole verification —
    // it should surface as "this field found nothing", same as any other
    // selector that doesn't match.
    private static int CountMatches(IDocument document, string selector)
    {
        try
        {
            return document.QuerySelectorAll(selector).Length;
        }
        catch (DomException)
        {
            return 0;
        }
    }
}
