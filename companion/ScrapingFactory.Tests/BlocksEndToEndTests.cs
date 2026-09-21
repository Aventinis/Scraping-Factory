using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc.Testing;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #182: Blocks — a list of independent extraction blocks sharing one
// navigation, each writing its own output file. Unlike Combined mode
// (Issue #239, separate scripts/separate subprocesses), this is ONE script/
// ONE verification subprocess with N output files checked at the end — the
// mutual-exclusion/structural checks below mirror CombinedEndToEndTests'
// own pattern against the real /generate endpoint; the happy-path test also
// proves the "blocks may freely mix shapes" decision (one flat block, one
// container/group block, from the very same page).
public class BlocksEndToEndTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    // Mirrors Program.cs's own ConfigureHttpJsonOptions — a Groups tree
    // (GroupNode/DataFieldNode, both ContainerNode) needs the same
    // polymorphic converter on the way out as the server registers for the
    // way back in, or the abstract base type serializes with none of its
    // derived properties (surfacing as a confusing "missing 'selector'"
    // deserialization error on the server side instead).
    private static readonly JsonSerializerOptions SerializeOptions = new()
    {
        Converters = { new JsonStringEnumConverter(), new ContainerNodeJsonConverter(), new ApiNodeJsonConverter(), new ApiBodyNodeJsonConverter() },
    };

    private static StringContent JsonBody(object value) =>
        new(JsonSerializer.Serialize(value, SerializeOptions), Encoding.UTF8, "application/json");

    private static ExtractionBlockConfig FlatBlock(string name, string fieldName, string selector) => new()
    {
        Name = name,
        Fields = [new ScrapingField { Name = fieldName, Selector = selector }],
        OutputFileName = name,
    };

    private const string MixedShapePage = """
        <html><body>
            <div class="deal">Sonderangebot 5€</div>
            <div class="deal">Sonderangebot 8€</div>
            <div class="category">
                <h2 class="category-name">Suppen</h2>
                <div class="item"><span class="item-name">Tomatensuppe</span></div>
                <div class="item"><span class="item-name">Kartoffelsuppe</span></div>
            </div>
        </body></html>
        """;

    [Fact]
    public async Task Generate_BlocksWithFieldsAlsoSet_Returns400()
    {
        using var server = new LocalTestServer(MixedShapePage);
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
            Blocks = [FlatBlock("a", "Deal", ".deal"), FlatBlock("b", "Deal", ".deal")],
        };

        var response = await _client.PostAsync("/generate", JsonBody(config));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("mutually exclusive", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Generate_BlocksWithOnlyOneBlock_Returns400()
    {
        using var server = new LocalTestServer(MixedShapePage);
        var config = new ScrapingConfig { Url = server.BaseUrl, Blocks = [FlatBlock("a", "Deal", ".deal")] };

        var response = await _client.PostAsync("/generate", JsonBody(config));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("at least 2", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Generate_BlockWithNeitherFieldsNorGroups_Returns400()
    {
        using var server = new LocalTestServer(MixedShapePage);
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Blocks = [new ExtractionBlockConfig { Name = "empty" }, FlatBlock("b", "Deal", ".deal")],
        };

        var response = await _client.PostAsync("/generate", JsonBody(config));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("exactly one of Fields or Groups", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Generate_BlocksWithDuplicateNames_Returns400()
    {
        using var server = new LocalTestServer(MixedShapePage);
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Blocks = [FlatBlock("deals", "Deal", ".deal"), FlatBlock("deals", "Deal", ".deal")],
        };

        var response = await _client.PostAsync("/generate", JsonBody(config));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Duplicate block names", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Generate_BlocksWithOuterChangeDetection_Returns400()
    {
        using var server = new LocalTestServer(MixedShapePage);
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            ChangeDetection = new ChangeDetectionConfig
            {
                Notify = "Webhook", Webhook = new WebhookNotificationConfig { UrlEnvVar = "SF_TEST_WEBHOOK" },
            },
            Blocks = [FlatBlock("a", "Deal", ".deal"), FlatBlock("b", "Deal", ".deal")],
        };

        var response = await _client.PostAsync("/generate", JsonBody(config));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("ChangeDetection", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Generate_BlocksWithOuterHardening_Returns400()
    {
        using var server = new LocalTestServer(MixedShapePage);
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Hardening = [new NoResultCheck { Severity = HardeningSeverity.Warning }],
            Blocks = [FlatBlock("a", "Deal", ".deal"), FlatBlock("b", "Deal", ".deal")],
        };

        var response = await _client.PostAsync("/generate", JsonBody(config));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Hardening", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Generate_BlocksHappyPath_MixedFlatAndGroupShapesEachWriteOwnFile()
    {
        using var server = new LocalTestServer(MixedShapePage);
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            IncludeOutputFile = true,
            Blocks =
            [
                FlatBlock("deals", "Preis", ".deal"),
                new ExtractionBlockConfig
                {
                    Name = "menu",
                    OutputFileName = "menu",
                    Groups =
                    [
                        new GroupNode
                        {
                            Name = "Kategorie", Selector = ".category", Repeating = true,
                            Children =
                            [
                                new DataFieldNode { Name = "Name", Selector = ".category-name", Mode = ExtractMode.Text },
                                new GroupNode
                                {
                                    Name = "Gericht", Selector = ".item", Repeating = true,
                                    Children = [new DataFieldNode { Name = "Name", Selector = ".item-name", Mode = ExtractMode.Text }],
                                },
                            ],
                        },
                    ],
                },
            ],
        };

        var response = await _client.PostAsync("/generate", JsonBody(config));
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(HttpStatusCode.OK == response.StatusCode, body);

        var envelope = JsonSerializer.Deserialize<JsonElement>(body);
        var blocks = envelope.GetProperty("blocks").EnumerateArray().ToList();
        Assert.Equal(2, blocks.Count);

        var dealsBlock = blocks.Single(b => b.GetProperty("name").GetString() == "deals");
        Assert.Equal("deals.csv", dealsBlock.GetProperty("outputFile").GetProperty("fileName").GetString());
        Assert.Contains("Sonderangebot 5€", dealsBlock.GetProperty("outputFile").GetProperty("content").GetString());

        var menuBlock = blocks.Single(b => b.GetProperty("name").GetString() == "menu");
        Assert.Equal("menu.xml", menuBlock.GetProperty("outputFile").GetProperty("fileName").GetString());
        Assert.Contains("Tomatensuppe", menuBlock.GetProperty("outputFile").GetProperty("content").GetString());
    }

    // Proves playwright_scraper_blocks.py.j2 (not just the static engine's
    // scraper_blocks.py.j2) is valid, runnable Python — the two templates
    // share the overall design but differ in every DOM-access call.
    [Fact]
    public async Task Generate_BlocksHappyPath_BrowserEngineMixedShapesEachWriteOwnFile()
    {
        using var server = new LocalTestServer(MixedShapePage);
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Engine = ScrapingEngine.Browser,
            IncludeOutputFile = true,
            Blocks =
            [
                FlatBlock("deals", "Preis", ".deal"),
                new ExtractionBlockConfig
                {
                    Name = "menu",
                    OutputFileName = "menu",
                    Groups =
                    [
                        new GroupNode
                        {
                            Name = "Kategorie", Selector = ".category", Repeating = true,
                            Children = [new DataFieldNode { Name = "Name", Selector = ".category-name", Mode = ExtractMode.Text }],
                        },
                    ],
                },
            ],
        };

        var response = await _client.PostAsync("/generate", JsonBody(config));
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(HttpStatusCode.OK == response.StatusCode, body);

        var envelope = JsonSerializer.Deserialize<JsonElement>(body);
        var blocks = envelope.GetProperty("blocks").EnumerateArray().ToList();
        var dealsBlock = blocks.Single(b => b.GetProperty("name").GetString() == "deals");
        Assert.Contains("Sonderangebot 5€", dealsBlock.GetProperty("outputFile").GetProperty("content").GetString());
        var menuBlock = blocks.Single(b => b.GetProperty("name").GetString() == "menu");
        Assert.Contains("Suppen", menuBlock.GetProperty("outputFile").GetProperty("content").GetString());
    }

    [Fact]
    public async Task Generate_BlocksPlainTextResponse_ContainsBothBlockNames()
    {
        using var server = new LocalTestServer(MixedShapePage);
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Blocks = [FlatBlock("deals", "Preis", ".deal"), FlatBlock("also_deals", "Preis", ".deal")],
        };

        var response = await _client.PostAsync("/generate", JsonBody(config));
        var body = await response.Content.ReadAsStringAsync();

        Assert.True(HttpStatusCode.OK == response.StatusCode, body);
        Assert.Contains("\"name\": 'deals'", body);
        Assert.Contains("\"name\": 'also_deals'", body);
    }

    [Fact]
    public async Task Generate_BlocksWithOneBlockFindingNothing_ReturnsUnprocessableEntityNamingBlock()
    {
        using var server = new LocalTestServer(MixedShapePage);
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Blocks =
            [
                FlatBlock("good", "Preis", ".deal"),
                FlatBlock("bad", "Preis", ".this-selector-matches-nothing"),
            ],
        };

        var response = await _client.PostAsync("/generate", JsonBody(config));
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        Assert.Contains("'bad'", body);
    }

    // /generate's trial run can only ever prove a block that failed with
    // literally zero data (see the test above) — it can't observe a
    // configured hardening/change-detection check's own runtime behavior
    // for a *non-empty* block the way CombinedSidecarPersistenceTests'
    // direct-subprocess approach can for Combined mode's baseline check,
    // since a fresh /generate trial run never has a "previous run" to
    // compare against. This asserts the per-block config is at least wired
    // into the right block's own literal in the generated script — one
    // block's HARDENING/change_detection dict is populated, the other
    // block's own entry stays disabled, proving the two blocks don't leak
    // configuration into each other.
    [Fact]
    public async Task Generate_BlocksWithPerBlockHardeningAndChangeDetection_OnlyConfiguredBlockGetsIt()
    {
        using var server = new LocalTestServer(MixedShapePage);
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Blocks =
            [
                new ExtractionBlockConfig
                {
                    Name = "watched", OutputFileName = "watched",
                    Fields = [new ScrapingField { Name = "Preis", Selector = ".deal" }],
                    Hardening = [new NoResultCheck { Severity = HardeningSeverity.Error }],
                    ChangeDetection = new ChangeDetectionConfig
                    {
                        Notify = "Webhook", Webhook = new WebhookNotificationConfig { UrlEnvVar = "SF_TEST_BLOCKS_WEBHOOK" },
                    },
                },
                FlatBlock("plain", "Preis", ".deal"),
            ],
        };

        var response = await _client.PostAsync("/generate", JsonBody(config));
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(HttpStatusCode.OK == response.StatusCode, body);

        // Both blocks' own dict literals are present in BLOCKS — only
        // "watched" should carry the enabled hardening/change-detection
        // config, "plain" must stay disabled for both.
        var watchedIndex = body.IndexOf("\"name\": 'watched'", StringComparison.Ordinal);
        var plainIndex = body.IndexOf("\"name\": 'plain'", StringComparison.Ordinal);
        Assert.True(watchedIndex >= 0 && plainIndex >= 0);

        var watchedDict = watchedIndex < plainIndex ? body[watchedIndex..plainIndex] : body[watchedIndex..];
        var plainDict = watchedIndex < plainIndex ? body[plainIndex..] : body[plainIndex..watchedIndex];

        Assert.Contains("\"enabled\": True", watchedDict);
        Assert.Contains("\"kind\": 'noResult'", watchedDict);
        Assert.Contains("SF_TEST_BLOCKS_WEBHOOK", watchedDict);

        Assert.DoesNotContain("\"kind\": 'noResult'", plainDict);
        Assert.DoesNotContain("SF_TEST_BLOCKS_WEBHOOK", plainDict);
    }
}
