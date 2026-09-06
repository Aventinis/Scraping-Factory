using System.Net;
using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// These tests actually spawn python3 and run the generated script — the
// whole point of PythonScriptVerifier is to prove the real artifact works,
// not to simulate it. Requires python3 + requests + beautifulsoup4 on the
// machine running the tests (same requirement the Companion App itself now
// has at runtime).
public class PythonScriptVerifierTests
{
    private static string GenerateScript(string url, params (string Name, string Selector)[] fields)
    {
        var steps = new List<ScrapingStep> { new NavigateStep { Url = url } };
        steps.AddRange(fields.Select(f => (ScrapingStep)new ExtractStep { Name = f.Name, Selector = f.Selector }));

        return new PythonCodeGenerator().Generate(new ScrapingPlan { Steps = steps });
    }

    [Fact]
    public async Task ScriptThatFindsData_Succeeds()
    {
        using var server = new LocalTestServer(
            "<html><body><ul><li class='item'>A</li><li class='item'>B</li></ul></body></html>");
        var script = GenerateScript(server.BaseUrl, ("Item", ".item"));

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.True(result.Success);
        Assert.Null(result.Error);
        Assert.Equal(2, result.RowCount);
    }

    [Fact]
    public async Task IncludePreviewFalse_LeavesPreviewNull()
    {
        using var server = new LocalTestServer(
            "<html><body><ul><li class='item'>A</li><li class='item'>B</li></ul></body></html>");
        var script = GenerateScript(server.BaseUrl, ("Item", ".item"));

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.True(result.Success);
        Assert.Null(result.Preview);
    }

    [Fact]
    public async Task IncludePreviewTrue_CsvOutput_PopulatesCappedSample()
    {
        using var server = new LocalTestServer(
            "<html><body><ul><li class='item'>A</li><li class='item'>B</li></ul></body></html>");
        var script = GenerateScript(server.BaseUrl, ("Item", ".item"));

        var result = await new PythonScriptVerifier().VerifyAsync(script, includePreview: true);

        Assert.True(result.Success);
        Assert.NotNull(result.Preview);
        Assert.Equal("Csv", result.Preview.OutputFormat);
        Assert.Equal(2, result.Preview.TotalCount);
        Assert.False(result.Preview.Truncated);
        Assert.Equal(["Item"], result.Preview.Columns);
        Assert.Equal(2, result.Preview.Rows!.Count);
        Assert.Equal("A", result.Preview.Rows[0]["Item"]);
        Assert.Equal("B", result.Preview.Rows[1]["Item"]);
    }

    [Fact]
    public async Task SelectorMatchingNothing_FailsWithZeroDataRows()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var script = GenerateScript(server.BaseUrl, ("Preis", ".price"));

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.False(result.Success);
        Assert.Contains("keine Daten", result.Error);
        Assert.Equal(0, result.RowCount);
    }

    [Fact]
    public async Task UnreachablePage_FailsWithScriptErrorOutput()
    {
        // Port 1 is a privileged, essentially-never-listening port — the
        // script's requests.get() should fail fast with a connection error.
        var script = GenerateScript("http://127.0.0.1:1/nope", ("Titel", "h1"));

        var result = await new PythonScriptVerifier(timeout: TimeSpan.FromSeconds(15)).VerifyAsync(script);

        Assert.False(result.Success);
        Assert.NotNull(result.Error);
    }

    [Fact]
    public async Task PageReturning500_FailsWithScriptErrorOutput()
    {
        using var server = new LocalTestServer("server error", HttpStatusCode.InternalServerError);
        var script = GenerateScript(server.BaseUrl, ("Titel", "h1"));

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.False(result.Success);
        Assert.NotNull(result.Error);
    }

    [Fact]
    public async Task CustomOutputFileBaseName_IsFoundAndVerified()
    {
        using var server = new LocalTestServer(
            "<html><body><ul><li class='item'>A</li><li class='item'>B</li></ul></body></html>");
        var steps = new List<ScrapingStep>
        {
            new NavigateStep { Url = server.BaseUrl },
            new ExtractStep { Name = "Item", Selector = ".item" },
        };
        var script = new PythonCodeGenerator().Generate(
            new ScrapingPlan { Steps = steps, OutputFileBaseName = "ergebnisse" });

        var result = await new PythonScriptVerifier().VerifyAsync(script, OutputFormat.Csv, "ergebnisse");

        Assert.True(result.Success, result.Error);
        Assert.Equal(2, result.RowCount);
    }

    [Fact]
    public async Task OutputFileBaseNameMismatch_FailsWithNotFoundError()
    {
        using var server = new LocalTestServer(
            "<html><body><ul><li class='item'>A</li></ul></body></html>");
        var steps = new List<ScrapingStep>
        {
            new NavigateStep { Url = server.BaseUrl },
            new ExtractStep { Name = "Item", Selector = ".item" },
        };
        // Script writes "ergebnisse.csv", but we ask the verifier to look for
        // the default "output.csv" — must fail, not silently pass.
        var script = new PythonCodeGenerator().Generate(
            new ScrapingPlan { Steps = steps, OutputFileBaseName = "ergebnisse" });

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.False(result.Success);
        Assert.Contains("keine output.csv erzeugt", result.Error);
    }

    [Fact]
    public async Task MissingPythonExecutable_FailsGracefully()
    {
        var verifier = new PythonScriptVerifier("definitely-not-a-real-python-executable-xyz");
        var script = GenerateScript("https://example.com", ("Titel", "h1"));

        var result = await verifier.VerifyAsync(script);

        Assert.False(result.Success);
        Assert.Contains("Kein Python-Interpreter gefunden", result.Error);
    }

    // ── Container-Mode (OutputFormat.Xml) ────────────────────────────────
    // Same "prove the real artifact works" philosophy as the CSV tests above
    // — a real python3 subprocess parses real HTML and writes a real
    // output.xml, which the verifier then has to parse itself.

    private static string GenerateGroupedScript(string url, GroupNode root)
    {
        var steps = new List<ScrapingStep> { new NavigateStep { Url = url }, new ExtractGroupStep { Roots = [root] } };
        return new PythonCodeGenerator().Generate(new ScrapingPlan { Steps = steps, OutputFormat = OutputFormat.Xml });
    }

    [Fact]
    public async Task GroupedScript_NestedRepeatingGroups_SucceedsAndWritesXml()
    {
        using var server = new LocalTestServer("""
            <html><body>
            <section class="menu-category"><h2>Vorspeisen</h2>
              <li class="menu-item"><h3>Suppe</h3><span class="price">5 €</span></li>
              <li class="menu-item"><h3>Salat</h3><span class="price">6 €</span></li>
            </section>
            <section class="menu-category"><h2>Suppen</h2>
              <li class="menu-item"><h3>Bouillabaisse</h3><span class="price">13 €</span></li>
            </section>
            </body></html>
            """);
        var root = new GroupNode
        {
            Name = "Kategorie",
            Selector = "section.menu-category",
            Repeating = true,
            Children =
            [
                new DataFieldNode { Name = "Titel", Selector = "h2" },
                new GroupNode
                {
                    Name = "Gericht",
                    Selector = "li.menu-item",
                    Repeating = true,
                    Children =
                    [
                        new DataFieldNode { Name = "Name", Selector = "h3" },
                        new DataFieldNode { Name = "Preis", Selector = ".price" },
                    ],
                },
            ],
        };
        var script = GenerateGroupedScript(server.BaseUrl, root);

        var result = await new PythonScriptVerifier().VerifyAsync(script, OutputFormat.Xml);

        Assert.True(result.Success, result.Error);
        Assert.Null(result.Error);
        // 2 <Kategorie> + 2 <Titel> + 3 <Gericht> + 3 <Name> + 3 <Preis> = 13
        Assert.Equal(13, result.RowCount);
    }

    [Fact]
    public async Task IncludePreviewTrue_XmlOutput_PopulatesXmlSample()
    {
        using var server = new LocalTestServer("""
            <html><body>
            <section class="menu-category"><h2>Vorspeisen</h2>
              <li class="menu-item"><h3>Suppe</h3></li>
            </section>
            </body></html>
            """);
        var root = new GroupNode
        {
            Name = "Kategorie",
            Selector = "section.menu-category",
            Repeating = true,
            Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }],
        };
        var script = GenerateGroupedScript(server.BaseUrl, root);

        var result = await new PythonScriptVerifier().VerifyAsync(script, OutputFormat.Xml, includePreview: true);

        Assert.True(result.Success, result.Error);
        Assert.NotNull(result.Preview);
        Assert.Equal("Xml", result.Preview.OutputFormat);
        Assert.False(result.Preview.Truncated);
        Assert.Contains("Vorspeisen", result.Preview.XmlSample);
    }

    [Fact]
    public async Task GroupedScript_NonRepeatingGroupWithZeroMatches_IsOmittedNotError()
    {
        using var server = new LocalTestServer("""
            <html><body>
            <section class="menu-category"><h2>Vorspeisen</h2>
              <li class="menu-item"><h3>Suppe</h3></li>
            </section>
            </body></html>
            """);
        var root = new GroupNode
        {
            Name = "Kategorie",
            Selector = "section.menu-category",
            Repeating = true,
            Children =
            [
                new GroupNode
                {
                    Name = "Badge",
                    Selector = ".does-not-exist",
                    Repeating = false, // 0 matches expected → omitted, not an error
                    Children = [new DataFieldNode { Name = "Text", Selector = "span" }],
                },
                new DataFieldNode { Name = "Titel", Selector = "h2" },
            ],
        };
        var script = GenerateGroupedScript(server.BaseUrl, root);

        var result = await new PythonScriptVerifier().VerifyAsync(script, OutputFormat.Xml);

        Assert.True(result.Success, result.Error);
        // 1 <Kategorie> + 1 <Titel>, no <Badge> since its group matched nothing
        Assert.Equal(2, result.RowCount);
    }

    [Fact]
    public async Task GroupedScript_SelectorMatchingNothing_FailsWithZeroElements()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var root = new GroupNode
        {
            Name = "Kategorie",
            Selector = ".does-not-exist",
            Repeating = true,
            Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }],
        };
        var script = GenerateGroupedScript(server.BaseUrl, root);

        var result = await new PythonScriptVerifier().VerifyAsync(script, OutputFormat.Xml);

        Assert.False(result.Success);
        Assert.Contains("keine Daten", result.Error);
        Assert.Equal(0, result.RowCount);
    }

    [Fact]
    public async Task GroupedScript_ExistsField_ReflectsPresenceAsTrueOrFalse()
    {
        using var server = new LocalTestServer("""
            <html><body>
            <section class="menu-category">
              <li class="menu-item"><h3>Salat</h3><span class="vegan">v</span></li>
              <li class="menu-item"><h3>Schnitzel</h3></li>
            </section>
            </body></html>
            """);
        var root = new GroupNode
        {
            Name = "Kategorie",
            Selector = "section.menu-category",
            Repeating = true,
            Children =
            [
                new GroupNode
                {
                    Name = "Gericht",
                    Selector = "li.menu-item",
                    Repeating = true,
                    Children =
                    [
                        new DataFieldNode { Name = "Name", Selector = "h3" },
                        new DataFieldNode { Name = "Vegan", Selector = ".vegan", Mode = ExtractMode.Exists },
                    ],
                },
            ],
        };
        var script = GenerateGroupedScript(server.BaseUrl, root);

        var result = await new PythonScriptVerifier().VerifyAsync(script, OutputFormat.Xml);

        Assert.True(result.Success, result.Error);
        // 1 Kategorie + 2 Gericht + 2 Name + 2 Vegan = 7
        Assert.Equal(7, result.RowCount);
    }
}
