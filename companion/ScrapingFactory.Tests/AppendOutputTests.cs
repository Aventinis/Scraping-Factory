using System.Diagnostics;
using System.Text.Json;
using System.Xml.Linq;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #342: AppendOutput makes a script append its result to the existing
// output file instead of replacing it, in every format. Each case runs the
// generated script as a real subprocess several times in ONE working
// directory (what /generate's always-fresh trial run can never exercise) and
// inspects the file the way a user would.
public class AppendOutputTests : IDisposable
{
    private readonly string _workDir = Directory.CreateTempSubdirectory("scrapingfactory-append-test-").FullName;

    public void Dispose() => Directory.Delete(_workDir, recursive: true);

    private async Task<(int Exit, string Stdout, string Stderr)> RunAsync(string script, string fileName = "scraper.py")
    {
        var path = Path.Combine(_workDir, fileName);
        await File.WriteAllTextAsync(path, script);
        foreach (var candidate in new[] { "python3", "python" })
        {
            var psi = new ProcessStartInfo(candidate) { WorkingDirectory = _workDir, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            psi.ArgumentList.Add(path);
            try
            {
                using var process = Process.Start(psi)!;
                var stdout = process.StandardOutput.ReadToEndAsync();
                var stderr = process.StandardError.ReadToEndAsync();
                await process.WaitForExitAsync(new CancellationTokenSource(TimeSpan.FromSeconds(90)).Token);
                return (process.ExitCode, await stdout, await stderr);
            }
            catch (System.ComponentModel.Win32Exception) { }
        }
        throw new InvalidOperationException("No Python interpreter found.");
    }

    private string Path_(string name) => Path.Combine(_workDir, name);
    private string[] Lines(string name) => File.ReadAllLines(Path_(name));

    private static string Html(params (string Title, string Price)[] items) =>
        "<html><body>" + string.Concat(items.Select(i => $"<div class='item'><h1>{i.Title}</h1><span class='price'>{i.Price}</span></div>")) + "</body></html>";

    private static string Generate(ScrapingPlan plan) => plan.Engine == ScrapingEngine.Browser
        ? new PythonPlaywrightCodeGenerator().Generate(plan)
        : plan.Engine == ScrapingEngine.Api ? new PythonApiCodeGenerator().Generate(plan) : new PythonCodeGenerator().Generate(plan);

    private static ScrapingPlan FlatPlan(string url, OutputFormat format = OutputFormat.Csv, bool append = true, bool withPrice = true,
        ScrapingEngine engine = ScrapingEngine.Static)
    {
        List<ExtractStep> fields = [new() { Name = "Titel", Selector = "h1" }];
        if (withPrice) fields.Add(new ExtractStep { Name = "Preis", Selector = ".price" });
        return new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = [url] }, .. fields],
            OutputFormat = format, AppendOutput = append, Engine = engine,
        };
    }

    // The page the server currently serves; tests swap it between runs.
    private sealed class Page : IDisposable
    {
        public string Html { get; set; }
        public LocalTestServer Server { get; }
        public Page(string html)
        {
            Html = html;
            Server = new LocalTestServer(_ => new LocalTestServerResponse(Html, "text/html; charset=utf-8"));
        }
        public string Url => Server.BaseUrl;
        public void Dispose() => Server.Dispose();
    }

    // ── Flat formats ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Csv_AppendsRows_WithTheHeaderOnlyOnce()
    {
        using var page = new Page(Html(("A", "1"), ("B", "2")));
        var script = Generate(FlatPlan(page.Url));

        Assert.Equal(0, (await RunAsync(script)).Exit);
        page.Html = Html(("C", "3"));
        var (exit, stdout, stderr) = await RunAsync(script);

        Assert.True(exit == 0, stderr);
        Assert.Equal(["Titel,Preis", "A,1", "B,2", "C,3"], Lines("output.csv"));
        Assert.Contains("1 rows appended to", stdout);
    }

    [Fact]
    public async Task WithoutTheOption_EveryRunReplacesTheFile()
    {
        using var page = new Page(Html(("A", "1")));
        var script = Generate(FlatPlan(page.Url, append: false));

        await RunAsync(script);
        page.Html = Html(("B", "2"));
        await RunAsync(script);

        Assert.Equal(["Titel,Preis", "B,2"], Lines("output.csv"));
    }

    // One drift rule for every format: the file's columns stay, new ones are
    // added, a missing value is empty.
    [Fact]
    public async Task Csv_SchemaDrift_AddsNewColumnsAndFillsGapsWithEmptyValues()
    {
        using var page = new Page(Html(("A", "1")));
        await RunAsync(Generate(FlatPlan(page.Url, withPrice: false)));       // Titel
        await RunAsync(Generate(FlatPlan(page.Url)));                          // Titel, Preis
        await RunAsync(Generate(FlatPlan(page.Url, withPrice: false)));       // Titel again

        Assert.Equal(["Titel,Preis", "A,", "A,1", "A,"], Lines("output.csv"));
    }

    [Fact]
    public async Task Json_AppendsToTheList()
    {
        using var page = new Page(Html(("A", "1")));
        var script = Generate(FlatPlan(page.Url, OutputFormat.Json));

        await RunAsync(script);
        page.Html = Html(("B", "2"));
        await RunAsync(script);

        var rows = JsonDocument.Parse(File.ReadAllText(Path_("output.json"))).RootElement.EnumerateArray().ToList();
        Assert.Equal(["A", "B"], rows.Select(r => r.GetProperty("Titel").GetString()!).ToArray());
    }

    private async Task<string> PythonAsync(string code, string name = "output_probe.py")
    {
        var (exit, stdout, stderr) = await RunAsync(code, name);
        Assert.True(exit == 0, stderr);
        return stdout.Trim();
    }

    [Fact]
    public async Task Sqlite_InsertsIntoTheExistingTable_AndAddsNewColumns()
    {
        using var page = new Page(Html(("A", "1")));
        await RunAsync(Generate(FlatPlan(page.Url, OutputFormat.Sqlite, withPrice: false)));
        // Something the user put into the database must survive.
        await PythonAsync("import sqlite3\nc = sqlite3.connect('output.sqlite')\nc.execute('CREATE TABLE notes (n TEXT)')\nc.execute(\"INSERT INTO notes VALUES ('keep me')\")\nc.commit()\n");
        page.Html = Html(("B", "2"));
        var (exit, _, stderr) = await RunAsync(Generate(FlatPlan(page.Url, OutputFormat.Sqlite)));

        Assert.True(exit == 0, stderr);
        var dump = await PythonAsync("import json, sqlite3\nc = sqlite3.connect('output.sqlite')\n" +
            "print(json.dumps({'cols': [r[1] for r in c.execute('PRAGMA table_info(data)')], 'rows': c.execute('SELECT * FROM data').fetchall(), 'notes': c.execute('SELECT n FROM notes').fetchall()}))");
        using var json = JsonDocument.Parse(dump);
        Assert.Equal(["Titel", "Preis"], json.RootElement.GetProperty("cols").EnumerateArray().Select(e => e.GetString()!).ToArray());
        Assert.Equal("""[["A",null],["B","2"]]""", json.RootElement.GetProperty("rows").GetRawText().Replace(" ", ""));
        Assert.Equal("""[["keepme"]]""", json.RootElement.GetProperty("notes").GetRawText().Replace(" ", ""));
    }

    [Fact]
    public async Task Excel_AppendsRowsToTheSheet_AndAddsNewColumns()
    {
        using var page = new Page(Html(("A", "1")));
        await RunAsync(Generate(FlatPlan(page.Url, OutputFormat.Xlsx, withPrice: false)));
        page.Html = Html(("B", "2"));
        var (exit, _, stderr) = await RunAsync(Generate(FlatPlan(page.Url, OutputFormat.Xlsx)));

        Assert.True(exit == 0, stderr);
        var dump = await PythonAsync("import json\nfrom openpyxl import load_workbook\nsheet = load_workbook('output.xlsx')['Data']\nprint(json.dumps([[c.value for c in row] for row in sheet.iter_rows()]))");
        Assert.Equal("""[["Titel","Preis"],["A",null],["B","2"]]""", dump.Replace(" ", ""));
    }

    // ── Tree formats ─────────────────────────────────────────────────────────

    private static ScrapingPlan GroupPlan(string url, OutputFormat format, DeduplicationConfig? dedup = null, ScrapingEngine engine = ScrapingEngine.Static) => new()
    {
        Steps =
        [
            new NavigateStep { Urls = [url] },
            new ExtractGroupStep
            {
                Roots = [new GroupNode { Name = "Eintrag", Selector = ".item", Repeating = true, Children = [new DataFieldNode { Name = "Titel", Selector = "h1", Mode = ExtractMode.Text }] }],
            },
        ],
        OutputFormat = format, AppendOutput = true, Deduplication = dedup, Engine = engine,
    };

    [Fact]
    public async Task Xml_AppendsChildrenUnderTheExistingRoot()
    {
        using var page = new Page(Html(("A", "1")));
        var script = Generate(GroupPlan(page.Url, OutputFormat.Xml));

        await RunAsync(script);
        page.Html = Html(("B", "2"));
        var (exit, _, stderr) = await RunAsync(script);

        Assert.True(exit == 0, stderr);
        var doc = XDocument.Load(Path_("output.xml"));
        Assert.Equal("Ergebnis", doc.Root!.Name.LocalName);
        Assert.Equal(["A", "B"], doc.Root.Descendants("Titel").Select(e => e.Value).ToArray());
    }

    [Fact]
    public async Task JsonTree_MergesUnderTheRoot_TurningRepeatedTagsIntoOneList()
    {
        using var page = new Page(Html(("A", "1")));
        var script = Generate(GroupPlan(page.Url, OutputFormat.Json));

        await RunAsync(script);
        page.Html = Html(("B", "2"), ("C", "3"));
        await RunAsync(script);

        var entries = JsonDocument.Parse(File.ReadAllText(Path_("output.json"))).RootElement.GetProperty("Eintrag").EnumerateArray().ToList();
        Assert.Equal(["A", "B", "C"], entries.Select(e => e.GetProperty("Titel").GetString()!).ToArray());
    }

    [Fact]
    public async Task ContainerFlattenedIntoSqlite_Appends()
    {
        using var page = new Page(Html(("A", "1")));
        var plan = ScrapingPlanBuilder.Build(new ScrapingConfig
        {
            Url = page.Url, OutputFormat = OutputFormat.Sqlite, AppendOutput = true,
            Groups = [new GroupNode { Name = "Eintrag", Selector = ".item", Repeating = true, Children = [new DataFieldNode { Name = "Titel", Selector = "h1", Mode = ExtractMode.Text }] }],
        });
        var script = Generate(plan);

        await RunAsync(script);
        page.Html = Html(("B", "2"));
        await RunAsync(script);

        var rows = await PythonAsync("import sqlite3\nprint([r[0] for r in sqlite3.connect('output.sqlite').execute('SELECT * FROM data')])");
        Assert.Equal("['A', 'B']", rows);
    }

    // Deduplication's incremental "Append" is one case of this mechanism —
    // and now works for a tree as well.
    [Fact]
    public async Task DedupIncrementalAppend_NowWorksForXmlTrees()
    {
        using var page = new Page(Html(("A", "1"), ("B", "2")));
        var plan = GroupPlan(page.Url, OutputFormat.Xml,
            new DeduplicationConfig { KeyFields = ["Titel"], Incremental = true, IncrementalOutput = IncrementalOutputMode.Append });
        var withoutFlag = new ScrapingPlan { Steps = plan.Steps, OutputFormat = plan.OutputFormat, Deduplication = plan.Deduplication };
        var script = Generate(withoutFlag);
        Assert.True(ScrapingPlanValidator.Validate(withoutFlag).Success);

        await RunAsync(script);
        page.Html = Html(("A", "1"), ("B", "2"), ("C", "3"));
        await RunAsync(script);

        Assert.Equal(["A", "B", "C"], XDocument.Load(Path_("output.xml")).Root!.Descendants("Titel").Select(e => e.Value).ToArray());
    }

    // ── API mode ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task ApiFlat_AppendsAcrossRuns()
    {
        var items = """{ "items": [ { "title": "a" } ] }""";
        using var server = new LocalTestServer(_ => new LocalTestServerResponse(items, "application/json"));
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = new ApiConfig
            {
                UrlTemplate = server.BaseUrl + "api", ItemsPath = "items", Fields = [new ApiField { Name = "Title", Path = "title" }],
            } }],
            OutputFormat = OutputFormat.Csv, Engine = ScrapingEngine.Api, AppendOutput = true,
        };
        var script = Generate(plan);

        await RunAsync(script);
        items = """{ "items": [ { "title": "b" } ] }""";
        await RunAsync(script);

        Assert.Equal(["Title", "a", "b"], Lines("output.csv"));
    }

    [Fact]
    public async Task ApiTree_AppendsToTheXmlFile()
    {
        var items = """{ "items": [ { "title": "a" } ] }""";
        using var server = new LocalTestServer(_ => new LocalTestServerResponse(items, "application/json"));
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = ["https://example.com"] }, new ApiCallStep { Config = new ApiConfig
            {
                UrlTemplate = server.BaseUrl + "api",
                Groups = [new ApiGroup { Name = "Item", Path = "items", Children = [new ApiField { Name = "Title", Path = "title" }] }],
            } }],
            OutputFormat = OutputFormat.Xml, Engine = ScrapingEngine.Api, AppendOutput = true,
        };
        var script = Generate(plan);

        await RunAsync(script);
        items = """{ "items": [ { "title": "b" } ] }""";
        await RunAsync(script);

        Assert.Equal(["a", "b"], XDocument.Load(Path_("output.xml")).Root!.Descendants("Title").Select(e => e.Value).ToArray());
    }

    // ── Blocks ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task Blocks_EachBlockAppendsToItsOwnFile()
    {
        using var page = new Page(Html(("A", "1")));
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [page.Url] },
                new ExtractionBlockStep
                {
                    Blocks =
                    [
                        new PlanExtractionBlock { Name = "flat", OutputFormat = OutputFormat.Csv, OutputFileBaseName = "flat", Fields = [new ExtractStep { Name = "Titel", Selector = "h1" }] },
                        new PlanExtractionBlock
                        {
                            Name = "tree", OutputFormat = OutputFormat.Xml, OutputFileBaseName = "tree",
                            Groups = [new GroupNode { Name = "Eintrag", Selector = ".item", Repeating = true, Children = [new DataFieldNode { Name = "Titel", Selector = "h1", Mode = ExtractMode.Text }] }],
                        },
                    ],
                },
            ],
            AppendOutput = true,
        };
        var script = Generate(plan);

        await RunAsync(script);
        page.Html = Html(("B", "2"));
        var (exit, _, stderr) = await RunAsync(script);

        Assert.True(exit == 0, stderr);
        Assert.Equal(["Titel", "A", "B"], Lines("flat.csv"));
        Assert.Equal(["A", "B"], XDocument.Load(Path_("tree.xml")).Root!.Descendants("Titel").Select(e => e.Value).ToArray());
    }

    // ── Browser engine ───────────────────────────────────────────────────────

    [Fact]
    public async Task Browser_Csv_Appends()
    {
        using var page = new Page(Html(("A", "1")));
        var script = Generate(FlatPlan(page.Url, engine: ScrapingEngine.Browser));

        await RunAsync(script);
        page.Html = Html(("B", "2"));
        var (exit, _, stderr) = await RunAsync(script);

        Assert.True(exit == 0, stderr);
        Assert.Equal(["Titel,Preis", "A,1", "B,2"], Lines("output.csv"));
    }

    // ── Unusable existing files stop the run instead of destroying data ─────

    [Theory]
    [InlineData(OutputFormat.Json, "output.json", "{\"not\": \"a list\"}", "not a JSON list")]
    [InlineData(OutputFormat.Json, "output.json", "[1, 2", "could not be read")]
    [InlineData(OutputFormat.Sqlite, "output.sqlite", "this is not a database, just text padded to be longer than a header", "not a usable SQLite")]
    [InlineData(OutputFormat.Xlsx, "output.xlsx", "not a workbook", "not a usable Excel")]
    public async Task AnUnusableExistingFile_StopsTheRunAndIsLeftUntouched(OutputFormat format, string file, string content, string message)
    {
        using var page = new Page(Html(("A", "1")));
        await File.WriteAllTextAsync(Path_(file), content);

        var (exit, _, stderr) = await RunAsync(Generate(FlatPlan(page.Url, format)));

        Assert.Equal(10, exit);
        Assert.Contains(message, stderr);
        Assert.DoesNotContain("Traceback", stderr);
        Assert.Equal(content, await File.ReadAllTextAsync(Path_(file)));
    }

    [Fact]
    public async Task Xml_ADifferentRootElement_StopsTheRun()
    {
        using var page = new Page(Html(("A", "1")));
        await File.WriteAllTextAsync(Path_("output.xml"), "<Other><x/></Other>");

        var (exit, _, stderr) = await RunAsync(Generate(GroupPlan(page.Url, OutputFormat.Xml)));

        Assert.Equal(10, exit);
        Assert.Contains("<Other>", stderr);
    }

    [Fact]
    public async Task An_EmptyExistingFile_IsTreatedAsTheFirstRun()
    {
        using var page = new Page(Html(("A", "1")));
        await File.WriteAllTextAsync(Path_("output.csv"), "");

        var (exit, _, stderr) = await RunAsync(Generate(FlatPlan(page.Url)));

        Assert.True(exit == 0, stderr);
        Assert.Equal(["Titel,Preis", "A,1"], Lines("output.csv"));
    }

    [Fact]
    public void GeneratedScript_WithoutTheOption_HasNoAppendCode()
    {
        var script = Generate(FlatPlan("https://example.com", append: false));
        Assert.DoesNotContain("_append_previous", script);
        Assert.DoesNotContain("EXIT_APPEND_FAILED", script);
    }
}
