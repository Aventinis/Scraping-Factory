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
        var steps = new List<ScrapingStep> { new NavigateStep { Urls = [url] } };
        steps.AddRange(fields.Select(f => (ScrapingStep)new ExtractStep { Name = f.Name, Selector = f.Selector }));

        return new PythonCodeGenerator().Generate(new ScrapingPlan { Steps = steps });
    }

    // Reproduces the real-world 403 (e.g. Wikipedia): a server that rejects
    // the bare "python-requests/x.y" default User-Agent, but accepts any
    // other value — proves the generated script actually sends a
    // non-default User-Agent, not just that the C#/template-level string
    // content looks right (see PythonCodeGeneratorTests for that).
    [Fact]
    public async Task ScriptWithoutCustomUserAgent_WouldGet403_ButGeneratedScriptSendsOneAndSucceeds()
    {
        using var server = new LocalTestServer(request =>
        {
            var userAgent = request.UserAgent ?? "";
            var isDefaultRequestsAgent = userAgent.Length == 0 || userAgent.StartsWith("python-requests");
            return isDefaultRequestsAgent
                ? new LocalTestServerResponse("Forbidden", "text/plain", HttpStatusCode.Forbidden)
                : new LocalTestServerResponse("<html><body><h1>Titel</h1></body></html>", "text/html; charset=utf-8");
        });
        var script = GenerateScript(server.BaseUrl, ("Titel", "h1"));

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, result.RowCount);
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

    // Issue #83: two real HTTP requests against distinct paths on the same
    // test server, proving the generated script actually visits every
    // configured start URL and combines the results into one output — not
    // just that the C#/template-level string content looks right (see
    // PythonCodeGeneratorTests for that).
    [Fact]
    public async Task MultipleUrls_CombinesRowsFromBothPagesIntoOneOutput()
    {
        using var server = new LocalTestServer(request =>
        {
            var html = request.Url!.AbsolutePath switch
            {
                "/a" => "<html><body><li class='item'>A1</li><li class='item'>A2</li></body></html>",
                "/b" => "<html><body><li class='item'>B1</li></body></html>",
                _ => "<html><body></body></html>",
            };
            return new LocalTestServerResponse(html, "text/html; charset=utf-8");
        });
        var steps = new List<ScrapingStep>
        {
            new NavigateStep { Urls = [$"{server.BaseUrl}a", $"{server.BaseUrl}b"] },
            new ExtractStep { Name = "Item", Selector = ".item" },
        };
        var script = new PythonCodeGenerator().Generate(new ScrapingPlan { Steps = steps });

        var result = await new PythonScriptVerifier().VerifyAsync(script, includePreview: true);

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, result.RowCount);
        var values = result.Preview!.Rows!.Select(row => row["Item"]).ToList();
        Assert.Equal(["A1", "A2", "B1"], values);
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

    // Issue #84: proves the transform chain actually runs correctly in the
    // real generated script, not just that the C#/template-level string
    // content looks right (see PythonCodeGeneratorTests for that) — the
    // whole point of this test class, per its own doc comment.
    [Fact]
    public async Task FieldWithTransformChain_AppliesTrimAndToNumber_InRealScript()
    {
        using var server = new LocalTestServer(
            "<html><body><p class='price'>  Preis: 12,99 &euro;  </p></body></html>");
        var steps = new List<ScrapingStep>
        {
            new NavigateStep { Urls = [server.BaseUrl] },
            new ExtractStep
            {
                Name = "Preis", Selector = ".price",
                Transforms =
                [
                    new TrimTransform(),
                    new RegexExtractTransform { Pattern = @"[\d,]+" },
                    new ToNumberTransform(),
                ],
            },
        };
        var script = new PythonCodeGenerator().Generate(new ScrapingPlan { Steps = steps });

        var result = await new PythonScriptVerifier().VerifyAsync(script, includePreview: true);

        Assert.True(result.Success, result.Error);
        Assert.Equal("12.99", result.Preview!.Rows![0]["Preis"]);
    }

    [Fact]
    public async Task SelectorMatchingNothing_FailsWithZeroDataRows()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var script = GenerateScript(server.BaseUrl, ("Preis", ".price"));

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.False(result.Success);
        Assert.Contains("no data", result.Error);
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
            new NavigateStep { Urls = [server.BaseUrl] },
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
            new NavigateStep { Urls = [server.BaseUrl] },
            new ExtractStep { Name = "Item", Selector = ".item" },
        };
        // Script writes "ergebnisse.csv", but we ask the verifier to look for
        // the default "output.csv" — must fail, not silently pass.
        var script = new PythonCodeGenerator().Generate(
            new ScrapingPlan { Steps = steps, OutputFileBaseName = "ergebnisse" });

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.False(result.Success);
        Assert.Contains("did not produce output.csv", result.Error);
    }

    // ── Flat mode (OutputFormat.Json, Issue #86) ────────────────────────

    private static string GenerateJsonScript(string url, params (string Name, string Selector)[] fields)
    {
        var steps = new List<ScrapingStep> { new NavigateStep { Urls = [url] } };
        steps.AddRange(fields.Select(f => (ScrapingStep)new ExtractStep { Name = f.Name, Selector = f.Selector }));

        return new PythonCodeGenerator().Generate(new ScrapingPlan { Steps = steps, OutputFormat = OutputFormat.Json });
    }

    [Fact]
    public async Task JsonOutput_ScriptThatFindsData_Succeeds()
    {
        using var server = new LocalTestServer(
            "<html><body><ul><li class='item'>A</li><li class='item'>B</li></ul></body></html>");
        var script = GenerateJsonScript(server.BaseUrl, ("Item", ".item"));

        var result = await new PythonScriptVerifier().VerifyAsync(script, OutputFormat.Json);

        Assert.True(result.Success, result.Error);
        Assert.Equal(2, result.RowCount);
    }

    [Fact]
    public async Task JsonOutput_IncludePreviewTrue_PopulatesCappedSample()
    {
        using var server = new LocalTestServer(
            "<html><body><ul><li class='item'>A</li><li class='item'>B</li></ul></body></html>");
        var script = GenerateJsonScript(server.BaseUrl, ("Item", ".item"));

        var result = await new PythonScriptVerifier().VerifyAsync(script, OutputFormat.Json, includePreview: true);

        Assert.True(result.Success, result.Error);
        Assert.NotNull(result.Preview);
        Assert.Equal("Json", result.Preview.OutputFormat);
        Assert.Equal(2, result.Preview.TotalCount);
        Assert.False(result.Preview.Truncated);
        Assert.Equal(["Item"], result.Preview.Columns);
        Assert.Equal(2, result.Preview.Rows!.Count);
        Assert.Equal("A", result.Preview.Rows[0]["Item"]);
        Assert.Equal("B", result.Preview.Rows[1]["Item"]);
    }

    [Fact]
    public async Task JsonOutput_SelectorMatchingNothing_FailsWithZeroDataRows()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var script = GenerateJsonScript(server.BaseUrl, ("Preis", ".price"));

        var result = await new PythonScriptVerifier().VerifyAsync(script, OutputFormat.Json);

        Assert.False(result.Success);
        Assert.Contains("no data", result.Error);
        Assert.Equal(0, result.RowCount);
    }

    [Fact]
    public async Task MissingPythonExecutable_FailsGracefully()
    {
        var verifier = new PythonScriptVerifier("definitely-not-a-real-python-executable-xyz");
        var script = GenerateScript("https://example.com", ("Titel", "h1"));

        var result = await verifier.VerifyAsync(script);

        Assert.False(result.Success);
        Assert.Contains("No Python interpreter found", result.Error);
    }

    // ── Container-Mode (OutputFormat.Xml) ────────────────────────────────
    // Same "prove the real artifact works" philosophy as the CSV tests above
    // — a real python3 subprocess parses real HTML and writes a real
    // output.xml, which the verifier then has to parse itself.

    private static string GenerateGroupedScript(string url, GroupNode root)
    {
        var steps = new List<ScrapingStep> { new NavigateStep { Urls = [url] }, new ExtractGroupStep { Roots = [root] } };
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

    // Issue #83: two real HTTP requests against distinct paths on the same
    // test server — proves each URL's own <Ergebnis> matches are merged into
    // one combined root instead of overwriting each other.
    [Fact]
    public async Task GroupedScript_MultipleUrls_CombinesElementsFromBothPagesIntoOneErgebnis()
    {
        using var server = new LocalTestServer(request =>
        {
            var html = request.Url!.AbsolutePath switch
            {
                "/a" => "<html><body><section class='menu-category'><h2>Vorspeisen</h2></section></body></html>",
                "/b" => "<html><body><section class='menu-category'><h2>Suppen</h2></section></body></html>",
                _ => "<html><body></body></html>",
            };
            return new LocalTestServerResponse(html, "text/html; charset=utf-8");
        });
        var root = new GroupNode
        {
            Name = "Kategorie", Selector = "section.menu-category", Repeating = true,
            Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }],
        };
        var steps = new List<ScrapingStep>
        {
            new NavigateStep { Urls = [$"{server.BaseUrl}a", $"{server.BaseUrl}b"] },
            new ExtractGroupStep { Roots = [root] },
        };
        var script = new PythonCodeGenerator().Generate(new ScrapingPlan { Steps = steps, OutputFormat = OutputFormat.Xml });

        var result = await new PythonScriptVerifier().VerifyAsync(script, OutputFormat.Xml, includePreview: true);

        Assert.True(result.Success, result.Error);
        // 2 <Kategorie> + 2 <Titel> = 4, one pair from each page
        Assert.Equal(4, result.RowCount);
        Assert.Contains("Vorspeisen", result.Preview!.XmlSample);
        Assert.Contains("Suppen", result.Preview.XmlSample);
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
        Assert.Contains("no data", result.Error);
        Assert.Equal(0, result.RowCount);
    }

    // ── Container-Mode (OutputFormat.Json, Issue #86) ────────────────────

    private static string GenerateGroupedJsonScript(string url, GroupNode root)
    {
        var steps = new List<ScrapingStep> { new NavigateStep { Urls = [url] }, new ExtractGroupStep { Roots = [root] } };
        return new PythonCodeGenerator().Generate(new ScrapingPlan { Steps = steps, OutputFormat = OutputFormat.Json });
    }

    [Fact]
    public async Task GroupedScript_JsonOutput_NestedRepeatingGroups_SucceedsAndWritesNestedJson()
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
        var script = GenerateGroupedJsonScript(server.BaseUrl, root);

        var result = await new PythonScriptVerifier().VerifyAsync(script, OutputFormat.Json, includePreview: true);

        Assert.True(result.Success, result.Error);
        Assert.Null(result.Error);
        // Not the same count as the Xml equivalent test (13): CountJsonNodes
        // counts object properties/array items, not per-tag elements, so a
        // leaf field folded into its parent's dict (no element of its own,
        // unlike XML) counts differently than a repeating group folded into
        // an array. Only "greater than zero" is actually load-bearing here.
        Assert.Equal(15, result.RowCount);
        Assert.NotNull(result.Preview);
        Assert.Equal("Json", result.Preview.OutputFormat);
        Assert.Contains("Vorspeisen", result.Preview.JsonSample);
        Assert.Contains("Suppe", result.Preview.JsonSample);
    }

    [Fact]
    public async Task GroupedScript_JsonOutput_SelectorMatchingNothing_FailsWithZeroElements()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var root = new GroupNode
        {
            Name = "Kategorie",
            Selector = ".does-not-exist",
            Repeating = true,
            Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }],
        };
        var script = GenerateGroupedJsonScript(server.BaseUrl, root);

        var result = await new PythonScriptVerifier().VerifyAsync(script, OutputFormat.Json);

        Assert.False(result.Success);
        Assert.Contains("no data", result.Error);
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

    // Issue #169: the exact real-world bug report — a badge <span> nested
    // directly inside the name <h3>, no separating whitespace in the
    // markup. Plain Text mode (the pre-existing default) would concatenate
    // both into one string; OwnText mode must extract only the direct text
    // node, proving the fix against the actual Python runtime rather than
    // just the C#-side codegen output (see PythonGroupCodeGeneratorTests for
    // that half).
    [Fact]
    public async Task GroupedScript_OwnTextField_ExcludesNestedBadgeText()
    {
        using var server = new LocalTestServer("""
            <html><body>
            <section class="menu-category">
              <li class="menu-item"><h3 class="item-name">Burrata mit Tomaten<span class="item-badge vegan">vegan möglich</span></h3></li>
              <li class="menu-item"><h3 class="item-name">Gebeizter Lachs</h3></li>
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
                    Children = [new DataFieldNode { Name = "Name", Selector = "h3.item-name", Mode = ExtractMode.OwnText }],
                },
            ],
        };
        var script = GenerateGroupedScript(server.BaseUrl, root);

        var result = await new PythonScriptVerifier().VerifyAsync(script, OutputFormat.Xml, includePreview: true);

        Assert.True(result.Success, result.Error);
        Assert.Contains("Burrata mit Tomaten</Name>", result.Preview!.XmlSample);
        Assert.DoesNotContain("vegan möglich", result.Preview.XmlSample);
        Assert.Contains("Gebeizter Lachs</Name>", result.Preview.XmlSample);
    }

    // Issue #88 follow-up: before this, /generate could only ever verify a
    // proxy-enabled config if the companion process's own OS environment
    // already had the proxy env var set — an awkward requirement purely for
    // testing (unlike FillStep, which has FillVerificationValues for
    // exactly this). Now a missing var just warns and connects directly, so
    // verification succeeds regardless of whether the companion host has it
    // configured (see ProxyEndToEndTests for the "does the warning/exit
    // code actually appear" half of this, and the sibling
    // MissingProxyEnvVar_WithNoOtherData_StillFailsNormally test below for
    // the "this doesn't mask a real zero-data failure" half).
    [Fact]
    public async Task MissingProxyEnvVar_StillSucceedsWithRealData()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var steps = new List<ScrapingStep>
        {
            new NavigateStep { Urls = [server.BaseUrl] },
            new ExtractStep { Name = "Titel", Selector = "h1" },
        };
        var script = new PythonCodeGenerator().Generate(new ScrapingPlan
        {
            Steps = steps,
            Proxy = new ProxyConfig { EnvironmentVariableName = "SF_TEST_VERIFIER_UNSET_PROXY_VAR" },
        });

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, result.RowCount);
    }

    // The dedicated exit code only makes verification lenient about *how*
    // the script exited — the existing "did it actually produce data" check
    // still applies on top, so a selector that legitimately matches nothing
    // still fails verification even when combined with a missing proxy var.
    [Fact]
    public async Task MissingProxyEnvVar_WithSelectorMatchingNothing_StillFails()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var steps = new List<ScrapingStep>
        {
            new NavigateStep { Urls = [server.BaseUrl] },
            new ExtractStep { Name = "Titel", Selector = ".does-not-exist" },
        };
        var script = new PythonCodeGenerator().Generate(new ScrapingPlan
        {
            Steps = steps,
            Proxy = new ProxyConfig { EnvironmentVariableName = "SF_TEST_VERIFIER_UNSET_PROXY_VAR" },
        });

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.False(result.Success);
        Assert.Contains("no data", result.Error);
    }
}
