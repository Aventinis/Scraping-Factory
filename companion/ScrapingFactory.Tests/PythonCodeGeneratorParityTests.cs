using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// PythonScrapingContextBuilder (introduced to de-duplicate context-building
// logic that used to be hand-copied between PythonCodeGenerator/Static and
// PythonPlaywrightCodeGenerator/Browser) exists specifically to make the two
// engines' own shared literals structurally impossible to drift apart — this
// class is the executable proof that promise actually holds, by generating
// the *same* plan through both engines and comparing the exact lines each
// one renders from a value the shared builder computed once. A future
// change to one engine's own file that accidentally stops using the shared
// builder for one of these values would show up here as a real assertion
// failure, not just a hoped-for code-review catch.
public class PythonCodeGeneratorParityTests
{
    private static readonly PythonCodeGenerator StaticGenerator = new();
    private static readonly PythonPlaywrightCodeGenerator BrowserGenerator = new();

    // Extracts one top-level "NAME = ..." assignment line verbatim, so two
    // scripts' otherwise-different surrounding code doesn't get in the way
    // of comparing just the one literal both engines are supposed to agree on.
    private static string ExtractAssignmentLine(string script, string variableName)
    {
        foreach (var line in script.Split('\n'))
        {
            if (line.StartsWith(variableName + " = ", StringComparison.Ordinal))
                return line;
        }
        throw new InvalidOperationException($"No '{variableName} = ...' line found in generated script.");
    }

    [Fact]
    public void GroupMode_GroupsLiteral_IsIdenticalAcrossEngines()
    {
        var plan = GroupModePlan();
        var staticScript = StaticGenerator.Generate(plan);
        var browserScript = BrowserGenerator.Generate(plan);

        Assert.Equal(ExtractAssignmentLine(staticScript, "GROUPS"), ExtractAssignmentLine(browserScript, "GROUPS"));
    }

    [Fact]
    public void GroupMode_DownloadEnabled_ProducesTheSameDownloadsDirInBothEngines()
    {
        var plan = GroupModePlan(download: true);
        var staticScript = StaticGenerator.Generate(plan);
        var browserScript = BrowserGenerator.Generate(plan);

        var expected = "DOWNLOADS_DIR = OUTPUT_PATH + \".downloads\"";
        Assert.Contains(expected, staticScript);
        Assert.Contains(expected, browserScript);
    }

    [Fact]
    public void GroupMode_DownloadDisabled_NeitherEngineEmitsDownloadsDir()
    {
        var plan = GroupModePlan(download: false);
        var staticScript = StaticGenerator.Generate(plan);
        var browserScript = BrowserGenerator.Generate(plan);

        Assert.DoesNotContain("DOWNLOADS_DIR", staticScript);
        Assert.DoesNotContain("DOWNLOADS_DIR", browserScript);
    }

    [Fact]
    public void GroupMode_HardeningLiteral_IsIdenticalAcrossEngines()
    {
        var plan = GroupModePlan(hardening: [new NoResultCheck { Severity = HardeningSeverity.Error }]);
        var staticScript = StaticGenerator.Generate(plan);
        var browserScript = BrowserGenerator.Generate(plan);

        Assert.Equal(ExtractAssignmentLine(staticScript, "HARDENING"), ExtractAssignmentLine(browserScript, "HARDENING"));
    }

    [Fact]
    public void FlatMode_FieldNamesAndAttributes_AreIdenticalAcrossEngines()
    {
        var plan = FlatModePlan();
        var staticScript = StaticGenerator.Generate(plan);
        var browserScript = BrowserGenerator.Generate(plan);

        // Both engines derive their own "fields" list from the exact same
        // BuildFlatModeContext call — every field name/selector/attribute
        // the Static engine renders must also appear in the Browser one.
        Assert.Contains("Titel", staticScript);
        Assert.Contains("Titel", browserScript);
        Assert.Contains("Link", staticScript);
        Assert.Contains("Link", browserScript);
        Assert.Contains("\"href\"", staticScript);
        Assert.Contains("\"href\"", browserScript);
    }

    [Fact]
    public void Blocks_AggregateFlags_AreIdenticalAcrossEngines()
    {
        var plan = BlocksModePlan();
        var staticScript = StaticGenerator.Generate(plan);
        var browserScript = BrowserGenerator.Generate(plan);

        Assert.Equal(ExtractAssignmentLine(staticScript, "BLOCKS"), ExtractAssignmentLine(browserScript, "BLOCKS"));
    }

    private static ScrapingPlan GroupModePlan(bool download = false, List<HardeningCheck>? hardening = null) => new()
    {
        Steps =
        [
            new NavigateStep { Urls = ["https://example.com/speisekarte"] },
            new ExtractGroupStep
            {
                Roots =
                [
                    new GroupNode
                    {
                        Name = "Item", Selector = ".item", Repeating = true,
                        Children =
                        [
                            new DataFieldNode { Name = "Titel", Selector = "h2" },
                            new DataFieldNode { Name = "Bild", Selector = "img", Mode = ExtractMode.Attribute, Attribute = "src", Download = download },
                        ],
                    },
                ],
            },
        ],
        Hardening = hardening,
    };

    private static ScrapingPlan FlatModePlan() => new()
    {
        Steps =
        [
            new NavigateStep { Urls = ["https://example.com/speisekarte"] },
            new ExtractStep { Name = "Titel", Selector = "h1" },
            new ExtractStep { Name = "Link", Selector = "a", Attribute = "href" },
        ],
    };

    private static ScrapingPlan BlocksModePlan() => new()
    {
        Steps =
        [
            new NavigateStep { Urls = ["https://example.com/speisekarte"] },
            new ExtractionBlockStep
            {
                Blocks =
                [
                    new PlanExtractionBlock
                    {
                        Name = "Titel", OutputFileBaseName = "titel", OutputFormat = OutputFormat.Csv,
                        Fields = [new ExtractStep { Name = "Titel", Selector = "h1" }],
                    },
                    new PlanExtractionBlock
                    {
                        Name = "Bilder", OutputFileBaseName = "bilder", OutputFormat = OutputFormat.Xml,
                        Groups = [new GroupNode { Name = "Item", Selector = ".item", Repeating = true, Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }] }],
                    },
                ],
            },
        ],
    };
}
