using System.Text.Json;
using System.Xml.Linq;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #225: real end-to-end proof of deduplication. Every case runs the
// generated script as an actual subprocess against a real local HTTP server
// and inspects the output file (and, for the cross-run mode, the sidecar
// file) directly — PythonScriptVerifier's own black-box "did it produce
// data" check can't tell a deduplicated run from a plain one. The
// cross-run cases reuse ONE working directory across several runs of the
// same script, the one thing /generate's always-fresh trial run can never
// exercise (same reasoning as HardeningBaselineEndToEndTests).
public class DeduplicationEndToEndTests : IDisposable
{
    private readonly string _workDir = Directory.CreateTempSubdirectory("scrapingfactory-dedup-test-").FullName;

    public void Dispose() => Directory.Delete(_workDir, recursive: true);

    // Writes the script into the shared working directory and runs it there;
    // calling this again re-runs it against the previous run's leftovers.
    private async Task<(int Exit, string Stdout, string Stderr)> RunAsync(string script)
    {
        var scriptPath = Path.Combine(_workDir, "scraper.py");
        await File.WriteAllTextAsync(scriptPath, script);
        var result = await ScriptRunner.RunAsync(scriptPath, _workDir, timeout: TimeSpan.FromSeconds(60));
        return (result.ExitCode, result.Stdout, result.Stderr);
    }

    private string[] ReadLines(string fileName)
    {
        var path = Path.Combine(_workDir, fileName);
        return File.Exists(path) ? File.ReadAllLines(path) : [];
    }

    private string StatePath(string outputFile) => Path.Combine(_workDir, outputFile + ".dedup-seen.json");

    private static HashSet<string> ReadSeenKeys(string statePath) =>
        JsonDocument.Parse(File.ReadAllText(statePath)).RootElement.GetProperty("seen").EnumerateObject().Select(p => p.Name).ToHashSet();

    private static string Html(params (string Title, string Price)[] items) =>
        "<html><body>" + string.Concat(items.Select(i => $"<div class='item'><h1>{i.Title}</h1><span class='price'>{i.Price}</span></div>")) + "</body></html>";

    private static ScrapingPlan FlatPlan(string url, DeduplicationConfig dedup, List<HardeningCheck>? hardening = null,
        OutputFormat format = OutputFormat.Csv, ScrapingEngine engine = ScrapingEngine.Static) => new()
    {
        Engine = engine,
        OutputFormat = format,
        Steps =
        [
            new NavigateStep { Urls = [url] },
            new ExtractStep { Name = "Titel", Selector = ".item h1" },
            new ExtractStep { Name = "Preis", Selector = ".price" },
        ],
        Deduplication = dedup,
        Hardening = hardening,
    };

    private static string Generate(ScrapingPlan plan) => new PythonCodeGenerator().Generate(plan);

    // ---- flat mode: within-run ----------------------------------------

    [Fact]
    public async Task Flat_WithinRun_DropsLaterRowWithSameKey()
    {
        using var server = new LocalTestServer(Html(("A", "1"), ("B", "2"), ("A", "9")));
        var plan = FlatPlan(server.BaseUrl, new DeduplicationConfig { KeyFields = ["Titel"] });

        var (exit, stdout, _) = await RunAsync(Generate(plan));

        Assert.Equal(0, exit);
        Assert.Equal(["Titel,Preis", "A,1", "B,2"], ReadLines("output.csv"));
        Assert.Contains("dropped 1 duplicate row(s)", stdout);
        Assert.False(File.Exists(StatePath("output.csv")), "within-run dedup must not create a sidecar file");
    }

    [Fact]
    public async Task Flat_CompositeKey_OnlyFullyIdenticalRowsAreDuplicates()
    {
        using var server = new LocalTestServer(Html(("A", "1"), ("A", "2"), ("A", "1")));
        var plan = FlatPlan(server.BaseUrl, new DeduplicationConfig { KeyFields = ["Titel", "Preis"] });

        await RunAsync(Generate(plan));

        Assert.Equal(["Titel,Preis", "A,1", "A,2"], ReadLines("output.csv"));
    }

    [Fact]
    public async Task Flat_RowWithoutAnyKeyValue_IsNeverDropped()
    {
        using var server = new LocalTestServer(Html(("", "1"), ("", "2")));
        var plan = FlatPlan(server.BaseUrl, new DeduplicationConfig { KeyFields = ["Titel"] });

        await RunAsync(Generate(plan));

        Assert.Equal(3, ReadLines("output.csv").Length); // header + both rows
    }

    [Fact]
    public async Task Flat_JsonOutput_DeduplicatesToo()
    {
        using var server = new LocalTestServer(Html(("A", "1"), ("A", "1"), ("B", "2")));
        var plan = FlatPlan(server.BaseUrl, new DeduplicationConfig { KeyFields = ["Titel"] }, format: OutputFormat.Json);

        await RunAsync(Generate(plan));

        var rows = JsonDocument.Parse(File.ReadAllText(Path.Combine(_workDir, "output.json"))).RootElement;
        Assert.Equal(2, rows.GetArrayLength());
    }

    // The empty-price row is dropped by the required-fields filter first, so
    // it must not "burn" its key: the later A with a price survives.
    [Fact]
    public async Task Flat_RequiredFieldsFilterRunsBeforeDedup()
    {
        using var server = new LocalTestServer(Html(("A", ""), ("A", "1")));
        var plan = FlatPlan(
            server.BaseUrl,
            new DeduplicationConfig { KeyFields = ["Titel"] },
            [new RequiredFieldsCheck { Severity = HardeningSeverity.Warning, FieldNames = ["Preis"] }]);

        await RunAsync(Generate(plan));

        Assert.Equal(["Titel,Preis", "A,1"], ReadLines("output.csv"));
    }

    // ---- flat mode: cross-run -------------------------------------------

    [Fact]
    public async Task Flat_Incremental_Delta_SecondRunWritesOnlyNewRows()
    {
        var html = Html(("A", "1"), ("B", "2"));
        using var server = new LocalTestServer(_ => new LocalTestServerResponse(html, "text/html; charset=utf-8"));
        var script = Generate(FlatPlan(server.BaseUrl, new DeduplicationConfig { KeyFields = ["Titel"], Incremental = true }));

        await RunAsync(script);
        Assert.Equal(["Titel,Preis", "A,1", "B,2"], ReadLines("output.csv"));
        Assert.Equal(new HashSet<string> { "[\"A\"]", "[\"B\"]" }, ReadSeenKeys(StatePath("output.csv")));

        html = Html(("A", "1"), ("B", "2"), ("C", "3"));
        var (exit, stdout, _) = await RunAsync(script);

        Assert.Equal(0, exit);
        Assert.Equal(["Titel,Preis", "C,3"], ReadLines("output.csv"));
        Assert.Contains("1 of 3 row(s) are new", stdout);
        Assert.Equal(3, ReadSeenKeys(StatePath("output.csv")).Count);
    }

    [Fact]
    public async Task Flat_Incremental_Delta_NothingNew_WritesHeaderOnlyAndStillSucceeds()
    {
        using var server = new LocalTestServer(Html(("A", "1")));
        var plan = FlatPlan(
            server.BaseUrl,
            new DeduplicationConfig { KeyFields = ["Titel"], Incremental = true },
            [new NoResultCheck { Severity = HardeningSeverity.Error }]);
        var script = Generate(plan);

        await RunAsync(script);
        var (exit, _, stderr) = await RunAsync(script);

        // An empty delta is the expected "nothing new" outcome — the
        // no-result hardening check judges the scraped data, not the delta.
        Assert.Equal(0, exit);
        Assert.DoesNotContain("ERROR", stderr);
        Assert.Equal(["Titel,Preis"], ReadLines("output.csv"));
    }

    [Fact]
    public async Task Flat_Incremental_Append_KeepsPreviousRowsAndAddsNewOnes()
    {
        var html = Html(("A", "1"), ("B", "2"));
        using var server = new LocalTestServer(_ => new LocalTestServerResponse(html, "text/html; charset=utf-8"));
        var script = Generate(FlatPlan(server.BaseUrl, new DeduplicationConfig
        {
            KeyFields = ["Titel"], Incremental = true, IncrementalOutput = IncrementalOutputMode.Append,
        }));

        await RunAsync(script);
        html = Html(("A", "1"), ("C", "3"));
        await RunAsync(script);

        Assert.Equal(["Titel,Preis", "A,1", "B,2", "C,3"], ReadLines("output.csv"));
    }

    [Fact]
    public async Task Flat_Incremental_Append_Json()
    {
        var html = Html(("A", "1"));
        using var server = new LocalTestServer(_ => new LocalTestServerResponse(html, "text/html; charset=utf-8"));
        var script = Generate(FlatPlan(server.BaseUrl, new DeduplicationConfig
        {
            KeyFields = ["Titel"], Incremental = true, IncrementalOutput = IncrementalOutputMode.Append,
        }, format: OutputFormat.Json));

        await RunAsync(script);
        html = Html(("A", "1"), ("B", "2"));
        await RunAsync(script);

        var rows = JsonDocument.Parse(File.ReadAllText(Path.Combine(_workDir, "output.json"))).RootElement;
        Assert.Equal(["A", "B"], rows.EnumerateArray().Select(r => r.GetProperty("Titel").GetString()!).ToArray());
    }

    [Fact]
    public async Task Flat_Incremental_RetentionMaxCount_KeepsOnlyTheNewestKeys()
    {
        using var server = new LocalTestServer(Html(("A", "1"), ("B", "2"), ("C", "3")));
        var script = Generate(FlatPlan(server.BaseUrl, new DeduplicationConfig
        {
            KeyFields = ["Titel"], Incremental = true,
            Retention = new DeduplicationRetention { Kind = DeduplicationRetentionKind.MaxCount, Value = 2 },
        }));

        await RunAsync(script);

        Assert.Equal(2, ReadSeenKeys(StatePath("output.csv")).Count);
    }

    [Fact]
    public async Task Flat_Incremental_RetentionMaxAge_ForgottenKeyCountsAsNewAgain()
    {
        using var server = new LocalTestServer(Html(("A", "1"), ("B", "2")));
        var script = Generate(FlatPlan(server.BaseUrl, new DeduplicationConfig
        {
            KeyFields = ["Titel"], Incremental = true,
            Retention = new DeduplicationRetention { Kind = DeduplicationRetentionKind.MaxAge, Value = 30 },
        }));

        // "A" was last seen long ago (expired), "B" just now.
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        await File.WriteAllTextAsync(
            StatePath("output.csv"),
            "{\"seen\": {\"[\\\"A\\\"]\": " + (now - 90L * 86400) + ", \"[\\\"B\\\"]\": " + now + "}}");

        await RunAsync(script);

        Assert.Equal(["Titel,Preis", "A,1"], ReadLines("output.csv"));
    }

    [Fact]
    public async Task Flat_Incremental_RunFlaggedAsFailed_DoesNotMarkItsRowsAsSeen()
    {
        using var server = new LocalTestServer(Html(("A", ""), ("B", "2")));
        var plan = FlatPlan(
            server.BaseUrl,
            new DeduplicationConfig { KeyFields = ["Titel"], Incremental = true },
            [new RequiredFieldsCheck { Severity = HardeningSeverity.Error, FieldNames = ["Preis"] }]);

        var (exit, _, _) = await RunAsync(Generate(plan));

        Assert.Equal(2, exit);
        Assert.False(File.Exists(StatePath("output.csv")));
    }

    [Fact]
    public async Task Flat_BrokenStateFile_IsTreatedAsNothingSeenYet()
    {
        using var server = new LocalTestServer(Html(("A", "1")));
        var script = Generate(FlatPlan(server.BaseUrl, new DeduplicationConfig { KeyFields = ["Titel"], Incremental = true }));
        await File.WriteAllTextAsync(StatePath("output.csv"), "this is not json");

        var (exit, _, _) = await RunAsync(script);

        Assert.Equal(0, exit);
        Assert.Equal(["Titel,Preis", "A,1"], ReadLines("output.csv"));
        Assert.Single(ReadSeenKeys(StatePath("output.csv")));
    }

    [Fact]
    public async Task Flat_BrowserEngine_DeduplicatesAndRemembersAcrossRuns()
    {
        var html = Html(("A", "1"), ("A", "1"), ("B", "2"));
        using var server = new LocalTestServer(_ => new LocalTestServerResponse(html, "text/html; charset=utf-8"));
        var plan = FlatPlan(
            server.BaseUrl, new DeduplicationConfig { KeyFields = ["Titel"], Incremental = true }, engine: ScrapingEngine.Browser);
        var script = new PythonPlaywrightCodeGenerator().Generate(plan);

        await RunAsync(script);
        Assert.Equal(["Titel,Preis", "A,1", "B,2"], ReadLines("output.csv"));

        html = Html(("A", "1"), ("B", "2"), ("C", "3"));
        await RunAsync(script);
        Assert.Equal(["Titel,Preis", "C,3"], ReadLines("output.csv"));
    }

    // ---- container mode -----------------------------------------------

    private static ScrapingPlan GroupPlan(string url, DeduplicationConfig dedup, GroupNode root,
        OutputFormat format = OutputFormat.Xml, ScrapingEngine engine = ScrapingEngine.Static) => new()
    {
        Engine = engine,
        OutputFormat = format,
        Steps = [new NavigateStep { Urls = [url] }, new ExtractGroupStep { Roots = [root] }],
        Deduplication = dedup,
    };

    private static GroupNode DishGroup() => new()
    {
        Name = "Gericht", Selector = ".item", Repeating = true,
        Children =
        [
            new DataFieldNode { Name = "Name", Selector = "h1" },
            new DataFieldNode { Name = "Preis", Selector = ".price" },
        ],
    };

    private XDocument ReadXml(string fileName = "output.xml") => XDocument.Load(Path.Combine(_workDir, fileName));

    [Fact]
    public async Task Container_WithinRun_DropsDuplicateInstance()
    {
        using var server = new LocalTestServer(Html(("A", "1"), ("B", "2"), ("A", "1")));
        var plan = GroupPlan(server.BaseUrl, new DeduplicationConfig { KeyFields = ["Name"] }, DishGroup());

        var (exit, stdout, _) = await RunAsync(new PythonCodeGenerator().Generate(plan));

        Assert.Equal(0, exit);
        Assert.Equal(["A", "B"], ReadXml().Root!.Elements("Gericht").Select(g => g.Element("Name")!.Value).ToArray());
        Assert.Contains("dropped 1 duplicate element(s)", stdout);
    }

    // The same dish listed under two categories: the inner (item) instance
    // owns the key, so the second occurrence is dropped without touching
    // either category — and the outer instances are not keyed by their first
    // item's name.
    [Fact]
    public async Task Container_Nested_SameItemInTwoCategories_DroppedOnlyAtTheItemLevel()
    {
        using var server = new LocalTestServer(
            "<html><body>"
            + "<div class='category'><h2>Kat1</h2>"
            + "<div class='item'><h1>A</h1><span class='price'>1</span></div>"
            + "<div class='item'><h1>B</h1><span class='price'>2</span></div></div>"
            + "<div class='category'><h2>Kat2</h2>"
            + "<div class='item'><h1>A</h1><span class='price'>1</span></div>"
            + "<div class='item'><h1>C</h1><span class='price'>3</span></div></div>"
            + "</body></html>");
        var root = new GroupNode
        {
            Name = "Kategorie", Selector = ".category", Repeating = true,
            Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }, DishGroup()],
        };
        var plan = GroupPlan(server.BaseUrl, new DeduplicationConfig { KeyFields = ["Name"] }, root);

        await RunAsync(new PythonCodeGenerator().Generate(plan));

        var categories = ReadXml().Root!.Elements("Kategorie").ToList();
        Assert.Equal(2, categories.Count);
        Assert.Equal(["A", "B"], categories[0].Elements("Gericht").Select(g => g.Element("Name")!.Value).ToArray());
        Assert.Equal(["C"], categories[1].Elements("Gericht").Select(g => g.Element("Name")!.Value).ToArray());
    }

    [Fact]
    public async Task Container_KeyFieldsNotOwnedByOneInstance_WarnsAndDeduplicatesNothing()
    {
        using var server = new LocalTestServer(
            "<html><body>"
            + "<div class='category'><h2>Kat1</h2><div class='item'><h1>A</h1><span class='price'>1</span></div></div>"
            + "<div class='category'><h2>Kat2</h2><div class='item'><h1>A</h1><span class='price'>1</span></div></div>"
            + "</body></html>");
        var root = new GroupNode
        {
            Name = "Kategorie", Selector = ".category", Repeating = true,
            Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }, DishGroup()],
        };
        // Titel lives in the outer group, Name in the inner one: no single
        // repeating instance owns both.
        var plan = GroupPlan(server.BaseUrl, new DeduplicationConfig { KeyFields = ["Titel", "Name"] }, root);

        var (exit, _, stderr) = await RunAsync(new PythonCodeGenerator().Generate(plan));

        Assert.Equal(0, exit);
        Assert.Contains("nothing was deduplicated", stderr);
        Assert.Equal(2, ReadXml().Descendants("Gericht").Count());
    }

    [Fact]
    public async Task Container_Incremental_Delta_SecondRunWritesOnlyNewInstances()
    {
        var html = Html(("A", "1"), ("B", "2"));
        using var server = new LocalTestServer(_ => new LocalTestServerResponse(html, "text/html; charset=utf-8"));
        var script = new PythonCodeGenerator().Generate(GroupPlan(
            server.BaseUrl, new DeduplicationConfig { KeyFields = ["Name"], Incremental = true }, DishGroup()));

        await RunAsync(script);
        Assert.Equal(2, ReadXml().Root!.Elements("Gericht").Count());

        html = Html(("A", "1"), ("B", "2"), ("C", "3"));
        var (exit, _, _) = await RunAsync(script);

        Assert.Equal(0, exit);
        Assert.Equal(["C"], ReadXml().Root!.Elements("Gericht").Select(g => g.Element("Name")!.Value).ToArray());
        Assert.Equal(3, ReadSeenKeys(StatePath("output.xml")).Count);
    }

    [Fact]
    public async Task Container_BrowserEngine_DeduplicatesWithinRun()
    {
        using var server = new LocalTestServer(Html(("A", "1"), ("A", "1"), ("B", "2")));
        var plan = GroupPlan(server.BaseUrl, new DeduplicationConfig { KeyFields = ["Name"] }, DishGroup(), engine: ScrapingEngine.Browser);

        await RunAsync(new PythonPlaywrightCodeGenerator().Generate(plan));

        Assert.Equal(2, ReadXml().Root!.Elements("Gericht").Count());
    }

    // ---- API mode -------------------------------------------------------

    private static string ItemsJson(params (int Id, string Name)[] items) =>
        "{ \"items\": [" + string.Join(",", items.Select(i => $"{{ \"id\": {i.Id}, \"name\": \"{i.Name}\" }}")) + "] }";

    [Fact]
    public async Task ApiFlat_WithinRun_DropsDuplicateRows_AndIncrementalDeltaWorks()
    {
        var json = ItemsJson((1, "A"), (2, "B"), (1, "A"));
        using var server = new LocalTestServer(_ => new LocalTestServerResponse(json, "application/json"));
        var api = new ApiConfig
        {
            UrlTemplate = server.BaseUrl + "items",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Id", Path = "id" }, new ApiField { Name = "Name", Path = "name" }],
        };
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
            Engine = ScrapingEngine.Api,
            OutputFormat = OutputFormat.Csv,
            Deduplication = new DeduplicationConfig { KeyFields = ["Id"], Incremental = true },
        };
        var script = new PythonApiCodeGenerator().Generate(plan);

        await RunAsync(script);
        Assert.Equal(["Id,Name", "1,A", "2,B"], ReadLines("output.csv"));

        json = ItemsJson((1, "A"), (2, "B"), (3, "C"));
        await RunAsync(script);
        Assert.Equal(["Id,Name", "3,C"], ReadLines("output.csv"));
    }

    [Fact]
    public async Task ApiFlat_Append_AccumulatesAcrossRuns()
    {
        var json = ItemsJson((1, "A"));
        using var server = new LocalTestServer(_ => new LocalTestServerResponse(json, "application/json"));
        var api = new ApiConfig
        {
            UrlTemplate = server.BaseUrl + "items",
            ItemsPath = "items",
            Fields = [new ApiField { Name = "Id", Path = "id" }, new ApiField { Name = "Name", Path = "name" }],
        };
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
            Engine = ScrapingEngine.Api,
            OutputFormat = OutputFormat.Csv,
            Deduplication = new DeduplicationConfig { KeyFields = ["Id"], Incremental = true, IncrementalOutput = IncrementalOutputMode.Append },
        };
        var script = new PythonApiCodeGenerator().Generate(plan);

        await RunAsync(script);
        json = ItemsJson((1, "A"), (2, "B"));
        await RunAsync(script);

        Assert.Equal(["Id,Name", "1,A", "2,B"], ReadLines("output.csv"));
    }

    [Fact]
    public async Task ApiTree_WithinRun_DropsDuplicateInstance()
    {
        var json = ItemsJson((1, "A"), (2, "B"), (1, "A"));
        using var server = new LocalTestServer(_ => new LocalTestServerResponse(json, "application/json"));
        var api = new ApiConfig
        {
            UrlTemplate = server.BaseUrl + "items",
            Groups =
            [
                new ApiGroup
                {
                    Name = "Artikel", Path = "items",
                    Children = [new ApiField { Name = "Id", Path = "id" }, new ApiField { Name = "Name", Path = "name" }],
                },
            ],
        };
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = api }],
            Engine = ScrapingEngine.Api,
            OutputFormat = OutputFormat.Xml,
            Deduplication = new DeduplicationConfig { KeyFields = ["Id"] },
        };

        var (exit, _, stderr) = await RunAsync(new PythonApiCodeGenerator().Generate(plan));

        Assert.True(exit == 0, stderr);
        Assert.Equal(["1", "2"], ReadXml().Descendants("Artikel").Select(a => a.Element("Id")!.Value).ToArray());
    }
}
