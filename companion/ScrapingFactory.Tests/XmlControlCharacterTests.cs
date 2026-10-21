using System.Xml.Linq;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #291: a scraped value containing a control character that XML 1.0 cannot
// represent (here U+0007) used to be written raw by xml.etree.ElementTree,
// producing an output.xml no conforming parser accepts — the companion's own
// trial-run check then failed with a confusing XmlException on every attempt.
// The generated script now strips such characters right before writing XML.
// The tests run the real script and parse the real output file (a black-box
// "did it succeed" check could not tell: the script itself always exited 0).
public class XmlControlCharacterTests
{
    private const string Dirty = "Kaf\u0007fee";

    private static List<GroupNode> Groups() =>
    [
        new GroupNode
        {
            Name = "Produkt", Selector = ".p", Repeating = true,
            Children = [new DataFieldNode { Name = "Titel", Selector = ".t", Mode = ExtractMode.Text }],
        },
    ];

    private static ScrapingPlan GroupPlan(string url, OutputFormat format, ScrapingEngine engine = ScrapingEngine.Static) => new()
    {
        Engine = engine,
        OutputFormat = format,
        Steps = [new NavigateStep { Urls = [url] }, new ExtractGroupStep { Roots = Groups() }],
    };

    private static async Task<string> RunAsync(ScrapingPlan plan, Func<ScrapingPlan, string> generate)
    {
        var result = await new PythonScriptVerifier().VerifyAsync(generate(plan), plan.OutputFormat, includeOutputFile: true);
        Assert.True(result.Success, result.Error);
        return result.OutputFileContent!;
    }

    private static void AssertCleanTitle(string xml)
    {
        var titles = XDocument.Parse(xml).Descendants("Titel").Select(e => e.Value).ToList();
        Assert.Equal(["Kaffee", "Tee"], titles);
    }

    [Fact]
    public async Task ContainerStatic_StripsTheControlCharacter_AndKeepsTheRest()
    {
        using var server = new LocalTestServer($"<html><body><div class='p'><span class='t'>{Dirty}</span></div><div class='p'><span class='t'>Tee</span></div></body></html>");
        AssertCleanTitle(await RunAsync(GroupPlan(server.BaseUrl, OutputFormat.Xml), p => new PythonCodeGenerator().Generate(p)));
    }

    [Fact]
    public async Task ContainerBrowser_StripsTheControlCharacter()
    {
        // Set through script so the browser's own HTML parser cannot interfere with the raw byte.
        using var server = new LocalTestServer(
            "<html><body><div class='p'><span class='t' id='a'></span></div><div class='p'><span class='t'>Tee</span></div>"
            + "<script>document.getElementById('a').textContent = 'Kaf\\u0007fee';</script></body></html>");
        AssertCleanTitle(await RunAsync(GroupPlan(server.BaseUrl, OutputFormat.Xml, ScrapingEngine.Browser), p => new PythonPlaywrightCodeGenerator().Generate(p)));
    }

    [Fact]
    public async Task ApiTree_StripsTheControlCharacter()
    {
        using var server = new LocalTestServer(_ => new LocalTestServerResponse(
            """{ "items": [ { "title": "Kaf\u0007fee" }, { "title": "Tee" } ] }""", "application/json"));
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Api,
            OutputFormat = OutputFormat.Xml,
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ApiCallStep
                {
                    Config = new ApiConfig
                    {
                        UrlTemplate = server.BaseUrl + "data",
                        Groups = [new ApiGroup { Name = "Produkt", Path = "items", Children = [new ApiField { Name = "Titel", Path = "title" }] }],
                    },
                },
            ],
        };
        AssertCleanTitle(await RunAsync(plan, p => new PythonApiCodeGenerator().Generate(p)));
    }

    [Fact]
    public async Task BlocksGroupBlock_StripsTheControlCharacter()
    {
        using var server = new LocalTestServer($"<html><body><h1>Titel</h1><div class='p'><span class='t'>{Dirty}</span></div><div class='p'><span class='t'>Tee</span></div></body></html>");
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ExtractionBlockStep
                {
                    Blocks =
                    [
                        new PlanExtractionBlock { Name = "flach", Fields = [new ExtractStep { Name = "H", Selector = "h1" }], OutputFormat = OutputFormat.Csv, OutputFileBaseName = "flach" },
                        new PlanExtractionBlock { Name = "baum", Groups = Groups(), OutputFormat = OutputFormat.Xml, OutputFileBaseName = "baum" },
                    ],
                },
            ],
        };
        var script = new PythonCodeGenerator().Generate(plan);
        var result = await new PythonScriptVerifier().VerifyBlocksAsync(
            script, [new BlockOutputSpec("flach", OutputFormat.Csv, "flach"), new BlockOutputSpec("baum", OutputFormat.Xml, "baum")], includeOutputFile: true);

        Assert.True(result.Success, result.Error);
        AssertCleanTitle(result.Blocks!.Single(b => b.Name == "baum").OutputFileContent!);
    }

    [Fact]
    public async Task JsonOutput_StillCarriesTheCharacter_AsAnEscape()
    {
        // JSON can represent it (\u0007), so nothing may be removed there.
        using var server = new LocalTestServer($"<html><body><div class='p'><span class='t'>{Dirty}</span></div></body></html>");
        var json = await RunAsync(GroupPlan(server.BaseUrl, OutputFormat.Json), p => new PythonCodeGenerator().Generate(p));
        Assert.Contains("Kaf\\u0007fee", json);
    }

    [Fact]
    public async Task OrdinaryWhitespaceAndUnicode_AreUntouched()
    {
        using var server = new LocalTestServer("<html><body><div class='p'><span class='t'>Käse\tund Brot 🍞</span></div></body></html>");
        var xml = await RunAsync(GroupPlan(server.BaseUrl, OutputFormat.Xml), p => new PythonCodeGenerator().Generate(p));
        Assert.Equal("Käse\tund Brot 🍞", XDocument.Parse(xml).Descendants("Titel").Single().Value);
    }
}
