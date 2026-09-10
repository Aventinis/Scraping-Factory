using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class PythonCodeGeneratorTests
{
    private readonly PythonCodeGenerator _generator = new();

    private static ScrapingPlan TwoFieldPlan() => new()
    {
        Steps =
        [
            new NavigateStep { Urls = ["https://books.toscrape.com"] },
            new ExtractStep { Name = "Titel", Selector = "h3 > a" },
            new ExtractStep { Name = "Link", Selector = "h3 > a", Attribute = "href" }
        ]
    };

    [Fact]
    public void Generate_ContainsTargetUrl()
    {
        var script = _generator.Generate(TwoFieldPlan());
        Assert.Contains("https://books.toscrape.com", script);
    }

    // Many sites (Wikipedia among them) reject the bare "python-requests/x.y"
    // default User-Agent with 403 Forbidden — see PythonScriptVerifierTests
    // for a real end-to-end reproduction/fix proof.
    [Fact]
    public void Generate_SendsUserAgentHeader()
    {
        var script = _generator.Generate(TwoFieldPlan());
        Assert.Contains("HEADERS = {\"User-Agent\":", script);
        Assert.Contains("requests.get(url, headers=HEADERS, timeout=10)", script);
    }

    // Issue #83
    [Fact]
    public void Generate_MultipleUrls_LoopsOverUrlsAndCombinesData()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com/a", "https://example.com/b"] },
                new ExtractStep { Name = "Titel", Selector = "h1" },
            ],
        };

        var script = _generator.Generate(plan);

        Assert.Contains("""URLS = ["https://example.com/a", "https://example.com/b"]""", script);
        Assert.Contains("for url in URLS:", script);
        Assert.Contains("data.extend(scrape(url))", script);
    }

    [Fact]
    public void Generate_FieldWithoutTransforms_HasEmptyTransformsListInDict()
    {
        var script = _generator.Generate(TwoFieldPlan());
        Assert.Contains("\"Titel\": [],", script);
    }

    [Fact]
    public void Generate_FieldWithTransforms_RendersTransformChainAndRuntimeHelper()
    {
        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep
                {
                    Name = "Preis", Selector = ".price",
                    Transforms = [new TrimTransform(), new ReplaceTransform { Find = "€", Replacement = "" }, new ToNumberTransform()],
                },
            ],
        };

        var script = _generator.Generate(plan);
        Assert.Contains("""{"kind": "trim"}""", script);
        Assert.Contains(""""kind": "replace", "find": '€', "replacement": ''"""", script);
        Assert.Contains("""{"kind": "toNumber"}""", script);
        Assert.Contains("def _apply_transforms(value, transforms):", script);
        Assert.Contains("def _to_number(value):", script);
        Assert.Contains("row[name] = _apply_transforms(raw_value, TRANSFORMS.get(name, []))", script);
    }

    [Fact]
    public void Generate_ContainsAllFieldNames()
    {
        var script = _generator.Generate(TwoFieldPlan());
        Assert.Contains("Titel", script);
        Assert.Contains("Link", script);
    }

    [Fact]
    public void Generate_ContainsAllSelectors()
    {
        var script = _generator.Generate(TwoFieldPlan());
        Assert.Contains("h3 > a", script);
    }

    [Fact]
    public void Generate_ContainsPythonImports()
    {
        var script = _generator.Generate(TwoFieldPlan());
        Assert.Contains("import requests", script);
        Assert.Contains("from bs4 import BeautifulSoup", script);
    }

    [Fact]
    public void Generate_ContainsCsvDictWriter()
    {
        var script = _generator.Generate(TwoFieldPlan());
        Assert.Contains("csv.DictWriter", script);
    }

    [Fact]
    public void Generate_ParsesResponseContentNotText()
    {
        // requests.Response.text guesses the encoding from the Content-Type
        // header and falls back to ISO-8859-1 when no charset is given,
        // mangling UTF-8 pages that only declare their charset via
        // <meta charset>. response.content (bytes) lets BeautifulSoup detect
        // that meta tag itself, so the generated script must use it.
        var script = _generator.Generate(TwoFieldPlan());
        Assert.Contains("BeautifulSoup(response.content,", script);
        Assert.DoesNotContain("BeautifulSoup(response.text,", script);
    }

    [Fact]
    public void Generate_AttributeFieldAppearsInAttributesDict()
    {
        var script = _generator.Generate(TwoFieldPlan());
        Assert.Contains("\"Link\": \"href\"", script);
    }

    [Fact]
    public void Generate_FieldWithoutAttributeNotInAttributesDict()
    {
        var script = _generator.Generate(TwoFieldPlan());
        // "Titel" has no attribute — must not appear in the ATTRIBUTES dict
        // itself (sliced up to its own closing brace, not further — Issue
        // #84's TRANSFORMS dict right below legitimately has a "Titel" key
        // regardless of attribute, so it must be excluded from this check).
        var attributesSection = script[(script.IndexOf("ATTRIBUTES") + "ATTRIBUTES".Length)..];
        Assert.DoesNotContain("\"Titel\"", attributesSection.Split("}")[0]);
    }

    [Fact]
    public void Generate_DefaultsToScraperAndOutputFileNames()
    {
        var script = _generator.Generate(TwoFieldPlan());
        Assert.Contains("python scraper.py", script);
        Assert.Contains("OUTPUT_PATH = \"output.csv\"", script);
        Assert.Contains("open(OUTPUT_PATH,", script);
        Assert.Contains("written to output.csv", script);
    }

    [Fact]
    public void Generate_UsesConfiguredFileNames()
    {
        var plan = TwoFieldPlan();
        plan = new ScrapingPlan
        {
            Steps = plan.Steps, OutputFormat = plan.OutputFormat, Engine = plan.Engine,
            ScriptFileName = "mein_scraper", OutputFileBaseName = "ergebnisse",
        };

        var script = _generator.Generate(plan);

        Assert.Contains("python mein_scraper.py", script);
        Assert.Contains("OUTPUT_PATH = \"ergebnisse.csv\"", script);
        Assert.Contains("written to ergebnisse.csv", script);
        Assert.DoesNotContain("output.csv", script);
    }

    // Issue #88
    [Fact]
    public void Generate_WithoutProxy_DoesNotImportOsOrItertools()
    {
        var script = _generator.Generate(TwoFieldPlan());
        Assert.DoesNotContain("import os", script);
        Assert.DoesNotContain("import itertools", script);
        Assert.DoesNotContain("PROXY_ENV_VAR", script);
        Assert.Contains("requests.get(url, headers=HEADERS, timeout=10)", script);
    }

    [Fact]
    public void Generate_WithProxy_ReadsListFromEnvironmentVariableAndRotates()
    {
        var plan = TwoFieldPlan();
        plan = new ScrapingPlan
        {
            Steps = plan.Steps, OutputFormat = plan.OutputFormat, Engine = plan.Engine,
            ScriptFileName = plan.ScriptFileName, OutputFileBaseName = plan.OutputFileBaseName,
            Proxy = new ProxyConfig { EnvironmentVariableName = "SF_PROXIES" },
        };

        var script = _generator.Generate(plan);

        Assert.Contains("import os", script);
        Assert.Contains("import itertools", script);
        Assert.Contains("PROXY_ENV_VAR = 'SF_PROXIES'", script);
        Assert.Contains("os.environ[PROXY_ENV_VAR]", script);
        Assert.Contains("itertools.cycle(_PROXY_LIST)", script);
        Assert.Contains(
            "requests.get(url, headers=HEADERS, proxies=_proxies_for_requests(), timeout=10)", script);
    }
}
