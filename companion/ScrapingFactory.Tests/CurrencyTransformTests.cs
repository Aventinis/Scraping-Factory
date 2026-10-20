using System.Text.Json;
using System.Text.Json.Serialization;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #234: ToCurrencyTransform ("Convert price/currency to number") —
// wire format, validation, and real end-to-end runs of the generated script
// for every supported format preset, so the runtime's own _to_currency
// (hand-duplicated into every template) is proven, not just its literal.
public class CurrencyTransformTests
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() },
    };

    [Fact]
    public void Deserialize_ToCurrencyByKind_ProducesToCurrencyTransform()
    {
        const string json = """{ "kind": "toCurrency", "format": "1,234.56", "onError": "UseDefault", "defaultValue": "0" }""";

        var transform = Assert.IsType<ToCurrencyTransform>(JsonSerializer.Deserialize<FieldTransform>(json, Options));

        Assert.Equal("1,234.56", transform.Format);
        Assert.Equal(TransformErrorMode.UseDefault, transform.OnError);
        Assert.Equal("0", transform.DefaultValue);
    }

    [Fact]
    public void Deserialize_ToCurrencyWithoutFormat_DefaultsToCommaDecimalPreset()
    {
        var transform = Assert.IsType<ToCurrencyTransform>(JsonSerializer.Deserialize<FieldTransform>("""{ "kind": "toCurrency" }""", Options));

        Assert.Equal("1.234,56", transform.Format);
        Assert.Equal(TransformErrorMode.KeepOriginal, transform.OnError);
    }

    private static PlanValidationResult ValidateWith(ToCurrencyTransform transform) => ScrapingPlanValidator.Validate(new ScrapingPlan
    {
        Steps =
        [
            new NavigateStep { Urls = ["https://example.com"] },
            new ExtractStep { Name = "Preis", Selector = ".price", Transforms = [transform] },
        ],
    });

    [Theory]
    [InlineData("1.234,56")]
    [InlineData("1,234.56")]
    [InlineData("1 234,56")]
    [InlineData("1'234.56")]
    public void Validate_SupportedFormat_Passes(string format)
    {
        var result = ValidateWith(new ToCurrencyTransform { Format = format });
        Assert.True(result.Success, result.Error);
    }

    [Theory]
    [InlineData("1234.56")]
    [InlineData("")]
    [InlineData("€ 1.234,56")]
    public void Validate_UnsupportedFormat_Fails(string format)
    {
        var result = ValidateWith(new ToCurrencyTransform { Format = format });
        Assert.False(result.Success);
        Assert.Contains("is not supported", result.Error);
    }

    [Fact]
    public void Validate_UseDefaultWithoutDefaultValue_Fails()
    {
        var result = ValidateWith(new ToCurrencyTransform { OnError = TransformErrorMode.UseDefault });
        Assert.False(result.Success);
        Assert.Contains("Default value", result.Error);
    }

    [Fact]
    public void GeneratedScript_CarriesFormatAndErrorMode()
    {
        var script = new PythonCodeGenerator().Generate(new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = "Preis", Selector = ".price", Transforms = [new ToCurrencyTransform { Format = "1'234.56", OnError = TransformErrorMode.UseDefault, DefaultValue = "0" }] },
            ],
        });
        Assert.Contains("""{"kind": "toCurrency", "format": '1\'234.56', "onError": 'UseDefault', "defaultValue": '0'}""", script);
        Assert.Contains("def _to_currency(value, number_format, on_error, default_value):", script);
    }

    // ── End to end: flat mode / static engine ────────────────────────────────

    private static async Task<List<string>> ScrapeValuesAsync(string[] rawValues, FieldTransform transform)
    {
        var items = string.Join("", rawValues.Select(v => $"<span class='value'>{v}</span>"));
        using var server = new LocalTestServer($"<html><head><meta charset='utf-8'></head><body>{items}</body></html>");
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractStep { Name = "Preis", Selector = ".value", Transforms = [transform] },
            ],
        };
        var result = await new PythonScriptVerifier().VerifyAsync(new PythonCodeGenerator().Generate(plan), includeOutputFile: true);
        Assert.True(result.Success, result.Error);
        return result.OutputFileContent!.Split('\n').Skip(1).Select(l => l.TrimEnd('\r')).Where(l => l.Length > 0).ToList();
    }

    [Theory]
    [InlineData("1.234,56", "Preis: 1.234,56 €", "1234.56")]
    [InlineData("1.234,56", "€ 1.234", "1234")] // thousands-only amount — the ambiguity toNumber gets wrong
    [InlineData("1.234,56", "12,90 €", "12.90")] // fraction digits kept exactly, never rounded
    [InlineData("1.234,56", "-12,99 €", "-12.99")]
    [InlineData("1.234,56", "1.234.567,00 EUR", "1234567.00")]
    [InlineData("1.234,56", "Preis: 12,99.", "12.99")] // trailing punctuation isn't part of the number
    [InlineData("1,234.56", "£51.77", "51.77")]
    [InlineData("1,234.56", "$1,234,567.8", "1234567.8")]
    [InlineData("1 234,56", "1 234,56 kr", "1234.56")]
    [InlineData("1 234,56", "1&#160;234,56 €", "1234.56")] // no-break space
    [InlineData("1'234.56", "CHF 1'234.50", "1234.50")]
    [InlineData("1'234.56", "CHF 1&#8217;234.50", "1234.50")] // typographic apostrophe
    public async Task ConvertsEachFormatPreset(string format, string raw, string expected)
    {
        var values = await ScrapeValuesAsync([raw], new ToCurrencyTransform { Format = format });
        Assert.Equal([expected], values);
    }

    [Fact]
    public async Task ValueNotMatchingTheFormat_KeepsOriginalByDefault()
    {
        // "12.99" under the comma-decimal preset: "." is a thousands separator
        // there, and "99" isn't a 3-digit group — a strict mismatch, not a guess.
        var values = await ScrapeValuesAsync(["12.99", "kein Preis"], new ToCurrencyTransform { Format = "1.234,56" });
        Assert.Equal(["12.99", "kein Preis"], values);
    }

    [Fact]
    public async Task ValueNotMatchingTheFormat_UsesConfiguredDefault()
    {
        var values = await ScrapeValuesAsync(["1,23,456", "Preis auf Anfrage"],
            new ToCurrencyTransform { Format = "1,234.56", OnError = TransformErrorMode.UseDefault, DefaultValue = "0" });
        Assert.Equal(["0", "0"], values);
    }

    // ── End to end: the other template families ──────────────────────────────

    [Fact]
    public async Task ContainerMode_ConvertsPricesPerInstance()
    {
        using var server = new LocalTestServer("""
            <html><head><meta charset='utf-8'></head><body>
              <div class='dish'><span class='price'>6,90 €</span></div>
              <div class='dish'><span class='price'>1.050,00 €</span></div>
            </body></html>
            """);
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractGroupStep
                {
                    Roots =
                    [
                        new GroupNode
                        {
                            Name = "Gericht", Selector = ".dish", Repeating = true,
                            Children = [new DataFieldNode { Name = "Preis", Selector = ".price", Transforms = [new ToCurrencyTransform()] }],
                        },
                    ],
                },
            ],
            OutputFormat = OutputFormat.Xml,
        };

        var result = await new PythonScriptVerifier().VerifyAsync(new PythonCodeGenerator().Generate(plan), OutputFormat.Xml, includeOutputFile: true);

        Assert.True(result.Success, result.Error);
        Assert.Contains("<Preis>6.90</Preis>", result.OutputFileContent);
        Assert.Contains("<Preis>1050.00</Preis>", result.OutputFileContent);
    }

    [Fact]
    public async Task ApiMode_ConvertsPriceStringsFromJson()
    {
        using var server = new LocalTestServer(_ => new LocalTestServerResponse(
            """{ "items": [ { "price": "EUR 2.499,00" }, { "price": "19,95 €" } ] }""", "application/json"));
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ApiCallStep
                {
                    Config = new ApiConfig
                    {
                        UrlTemplate = $"{server.BaseUrl}api/items",
                        ItemsPath = "items",
                        Fields = [new ApiField { Name = "Preis", Path = "price", Transforms = [new ToCurrencyTransform()] }],
                    },
                },
            ],
            Engine = ScrapingEngine.Api,
        };

        var result = await new PythonScriptVerifier().VerifyAsync(new PythonApiCodeGenerator().Generate(plan), includeOutputFile: true);

        Assert.True(result.Success, result.Error);
        Assert.Contains("2499.00", result.OutputFileContent);
        Assert.Contains("19.95", result.OutputFileContent);
    }
}
