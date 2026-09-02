using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class CompanionEndpointTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    // /generate now actually runs the generated script (a real Python
    // subprocess making its own HTTP request) before responding, so tests
    // that expect it to succeed need a real, reachable page — LocalTestServer
    // serves canned HTML on loopback instead of depending on the internet.
    // Health/validation-only tests never reach verification and keep using
    // the plain factory client.
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Health_Returns200()
    {
        var response = await _client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Generate_ValidConfig_Returns200WithTextPlain()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }]
        };

        var content = new StringContent(
            JsonSerializer.Serialize(config),
            Encoding.UTF8,
            "application/json");

        var response = await _client.PostAsync("/generate", content);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/plain", response.Content.Headers.ContentType?.MediaType);

        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(server.BaseUrl, body);
        Assert.Contains("import requests", body);
    }

    // Proves ScriptFileName/OutputFileName are wired end-to-end: sanitized,
    // baked into the generated script's comment/open() calls, and verified
    // against the *same* sanitized output filename (not the "output.csv"
    // default) — a mismatch here would make every custom-named request fail
    // verification even though the script itself is fine.
    [Fact]
    public async Task Generate_CustomFileNames_Returns200WithSanitizedNamesInScript()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
            ScriptFileName = "mein scraper!",
            OutputFileName = "../../etc/ergebnisse",
        };

        var content = new StringContent(JsonSerializer.Serialize(config), Encoding.UTF8, "application/json");
        var response = await _client.PostAsync("/generate", content);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("python mein_scraper.py", body);
        Assert.Contains("etc_ergebnisse.csv", body);
        Assert.DoesNotContain("output.csv", body);
    }

    // Proves the Browser engine is wired end-to-end through the real HTTP
    // endpoint: engine selection, Playwright codegen, and real verification
    // via an actual Chromium subprocess (not just unit-level codegen tests).
    [Fact]
    public async Task Generate_BrowserEngine_Returns200WithPlaywrightScript()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
            Engine = ScrapingEngine.Browser,
        };

        var content = new StringContent(JsonSerializer.Serialize(config), Encoding.UTF8, "application/json");
        var response = await _client.PostAsync("/generate", content);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("from playwright.sync_api import sync_playwright", body);
    }

    // Proves BrowserActions is wired end-to-end through the real HTTP
    // endpoint: wire-format "kind"-discriminated JSON → ScrapingPlanBuilder
    // → ScrollStep → PythonPlaywrightCodeGenerator → real verification via
    // an actual Chromium subprocess scrolling a page that lazy-loads content.
    [Fact]
    public async Task Generate_BrowserActionsWithScroll_Returns200WithAllItemsExtracted()
    {
        using var server = new LocalTestServer("""
            <html><body>
            <div id="list"><div class="item">1</div><div class="item">2</div></div>
            <div style="height: 2000px;"></div>
            <script>
              var total = 6;
              var loaded = 2;
              window.addEventListener('scroll', function () {
                if (loaded >= total) return;
                var list = document.getElementById('list');
                var el = document.createElement('div');
                el.className = 'item';
                el.textContent = String(++loaded);
                list.appendChild(el);
              });
            </script>
            </body></html>
            """);
        var payload = $$"""
            {
              "url": "{{server.BaseUrl}}",
              "engine": "Browser",
              "fields": [ { "name": "Item", "selector": ".item" } ],
              "browserActions": [
                { "kind": "scroll", "maxIterations": 10, "waitAfterMs": 300 }
              ]
            }
            """;
        var content = new StringContent(payload, Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/generate", content);
        var body = await response.Content.ReadAsStringAsync();

        Assert.True(HttpStatusCode.OK == response.StatusCode, body);
        Assert.Contains("_scroll_prev_height", body);
    }

    // Issue #43: proves verificationValues is wired end-to-end through the
    // real HTTP endpoint — the one-time login test values reach the
    // verification subprocess (via FillVerificationValues.Filter →
    // PythonScriptVerifier's extraEnvironmentVariables), letting a login
    // flow verify successfully without the credentials ever needing to be
    // set in the companion process's own OS environment. Also proves the
    // literal test password never ends up in the returned script text.
    [Fact]
    public async Task Generate_LoginFlowWithVerificationValues_Returns200()
    {
        using var server = new LocalTestServer("""
            <html><body>
            <input id="username" type="text" />
            <input id="password" type="password" />
            <button id="submit" onclick="
              if (document.getElementById('username').value === 'alice' &amp;&amp;
                  document.getElementById('password').value === 's3cret') {
                var el = document.createElement('div');
                el.className = 'welcome';
                el.textContent = 'Welcome, alice';
                document.body.appendChild(el);
              }
            ">Login</button>
            </body></html>
            """);
        var payload = $$"""
            {
              "url": "{{server.BaseUrl}}",
              "engine": "Browser",
              "fields": [ { "name": "Welcome", "selector": ".welcome" } ],
              "browserActions": [
                { "kind": "fill", "selector": "#username", "environmentVariableName": "SF_TEST_USER" },
                { "kind": "fill", "selector": "#password", "environmentVariableName": "SF_TEST_PASS" },
                { "kind": "click", "selector": "#submit" },
                { "kind": "waitFor", "selector": ".welcome", "timeoutMs": 5000 }
              ],
              "verificationValues": { "SF_TEST_USER": "alice", "SF_TEST_PASS": "s3cret" }
            }
            """;
        var content = new StringContent(payload, Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/generate", content);
        var body = await response.Content.ReadAsStringAsync();

        Assert.True(HttpStatusCode.OK == response.StatusCode, body);
        Assert.DoesNotContain("s3cret", body);
    }

    // Documents/locks in the exact gap Issue #43 closes: without
    // verificationValues, the trial subprocess never sees the credentials
    // (the companion process's own OS environment doesn't have them either),
    // so the WaitFor for the post-login element times out and verification
    // fails with 422 instead of succeeding.
    [Fact]
    public async Task Generate_LoginFlowWithoutVerificationValues_Returns422()
    {
        using var server = new LocalTestServer("""
            <html><body>
            <input id="username" type="text" />
            <input id="password" type="password" />
            <button id="submit" onclick="
              if (document.getElementById('username').value === 'alice' &amp;&amp;
                  document.getElementById('password').value === 's3cret') {
                var el = document.createElement('div');
                el.className = 'welcome';
                el.textContent = 'Welcome, alice';
                document.body.appendChild(el);
              }
            ">Login</button>
            </body></html>
            """);
        var payload = $$"""
            {
              "url": "{{server.BaseUrl}}",
              "engine": "Browser",
              "fields": [ { "name": "Welcome", "selector": ".welcome" } ],
              "browserActions": [
                { "kind": "fill", "selector": "#username", "environmentVariableName": "SF_TEST_USER_2" },
                { "kind": "fill", "selector": "#password", "environmentVariableName": "SF_TEST_PASS_2" },
                { "kind": "click", "selector": "#submit" },
                { "kind": "waitFor", "selector": ".welcome", "timeoutMs": 2000 }
              ]
            }
            """;
        var content = new StringContent(payload, Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/generate", content);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    // Proves FillVerificationValues.Filter actually filters — a stray key
    // that doesn't match any FillAction's env var name is ignored rather
    // than e.g. rejected outright, while the correct keys still verify.
    [Fact]
    public async Task Generate_LoginFlowWithUnrelatedVerificationValueKey_IsIgnored()
    {
        using var server = new LocalTestServer("""
            <html><body>
            <input id="username" type="text" />
            <input id="password" type="password" />
            <button id="submit" onclick="
              if (document.getElementById('username').value === 'alice' &amp;&amp;
                  document.getElementById('password').value === 's3cret') {
                var el = document.createElement('div');
                el.className = 'welcome';
                el.textContent = 'Welcome, alice';
                document.body.appendChild(el);
              }
            ">Login</button>
            </body></html>
            """);
        var payload = $$"""
            {
              "url": "{{server.BaseUrl}}",
              "engine": "Browser",
              "fields": [ { "name": "Welcome", "selector": ".welcome" } ],
              "browserActions": [
                { "kind": "fill", "selector": "#username", "environmentVariableName": "SF_TEST_USER_3" },
                { "kind": "fill", "selector": "#password", "environmentVariableName": "SF_TEST_PASS_3" },
                { "kind": "click", "selector": "#submit" },
                { "kind": "waitFor", "selector": ".welcome", "timeoutMs": 5000 }
              ],
              "verificationValues": {
                "SF_TEST_USER_3": "alice",
                "SF_TEST_PASS_3": "s3cret",
                "SF_UNRELATED": "whatever"
              }
            }
            """;
        var content = new StringContent(payload, Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/generate", content);
        var body = await response.Content.ReadAsStringAsync();

        Assert.True(HttpStatusCode.OK == response.StatusCode, body);
    }

    // Caught by ScrapingPlanValidator's fast structural pre-check (same class
    // of failure as Generate_InvalidUrlScheme_Returns400) — never spawns a
    // Python subprocess.
    [Fact]
    public async Task Generate_BrowserActionsWithStaticEngine_Returns400()
    {
        var payload = """
            {
              "url": "https://example.com",
              "fields": [ { "name": "Titel", "selector": "h1" } ],
              "browserActions": [ { "kind": "scroll" } ]
            }
            """;
        var content = new StringContent(payload, Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/generate", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Contains("Engine", doc.RootElement.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Generate_SelectorMatchesNothing_Returns422WithError()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var config = new ScrapingConfig
        {
            Url = server.BaseUrl,
            Fields = [new ScrapingField { Name = "Preis", Selector = ".price" }],
        };

        var content = new StringContent(JsonSerializer.Serialize(config), Encoding.UTF8, "application/json");
        var response = await _client.PostAsync("/generate", content);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Contains("keine Daten", doc.RootElement.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Generate_PageUnreachable_Returns422WithError()
    {
        var config = new ScrapingConfig
        {
            Url = "http://127.0.0.1:1/nope", // privileged port, essentially never listening
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
        };
        var content = new StringContent(JsonSerializer.Serialize(config), Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/generate", content);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.False(string.IsNullOrWhiteSpace(doc.RootElement.GetProperty("error").GetString()));
    }

    [Fact]
    public async Task Generate_MissingUrl_Returns400()
    {
        var payload = JsonSerializer.Serialize(new { Fields = new[] { new { Name = "x", Selector = "h1" } } });
        var content = new StringContent(payload, Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/generate", content);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Generate_EmptyFields_Returns400()
    {
        var config = new ScrapingConfig { Url = "https://example.com" };
        var content = new StringContent(
            JsonSerializer.Serialize(config),
            Encoding.UTF8,
            "application/json");

        var response = await _client.PostAsync("/generate", content);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // Caught by the fast ScrapingPlanValidator pre-check — never spawns a
    // Python subprocess or touches the network, unlike the 422 cases above.
    [Fact]
    public async Task Generate_InvalidUrlScheme_Returns400()
    {
        var config = new ScrapingConfig
        {
            Url = "ftp://example.com",
            Fields = [new ScrapingField { Name = "Titel", Selector = "h1" }],
        };
        var content = new StringContent(JsonSerializer.Serialize(config), Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/generate", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Contains("Ungültige URL", doc.RootElement.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Generate_DuplicateFieldNames_Returns400()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Fields =
            [
                new ScrapingField { Name = "Titel", Selector = "h1" },
                new ScrapingField { Name = "Titel", Selector = "h2" },
            ],
        };
        var content = new StringContent(JsonSerializer.Serialize(config), Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/generate", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Contains("Doppelte Feldnamen", doc.RootElement.GetProperty("error").GetString());
    }

    // Reproduces the exact wire format sent by the browser extension
    // (camelCase property names, outputFormat as a string) — this is
    // what regressed to always return 400 without a JsonStringEnumConverter.
    [Fact]
    public async Task Generate_ExtensionStylePayload_Returns200()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var payload = $$"""
            {
              "version": "1",
              "url": "{{server.BaseUrl}}",
              "fields": [ { "name": "Titel", "selector": "h1", "attribute": null } ],
              "outputFormat": "Csv"
            }
            """;
        var content = new StringContent(payload, Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/generate", content);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // Container-Mode wire payload: "groups" instead of "fields", nested
    // "children" — no "outputFormat" needed, the server forces Xml itself
    // (see ScrapingPlanBuilder).
    [Fact]
    public async Task Generate_GroupsPayload_Returns200WithXmlScript()
    {
        using var server = new LocalTestServer("""
            <html><body>
            <section class="menu-category"><h2>Vorspeisen</h2>
              <li class="menu-item"><h3>Suppe</h3></li>
            </section>
            </body></html>
            """);
        var payload = $$"""
            {
              "version": "1",
              "url": "{{server.BaseUrl}}",
              "groups": [
                {
                  "name": "Kategorie",
                  "selector": "section.menu-category",
                  "repeating": true,
                  "children": [
                    { "name": "Titel", "selector": "h2" },
                    {
                      "name": "Gericht",
                      "selector": "li.menu-item",
                      "repeating": true,
                      "children": [ { "name": "Name", "selector": "h3" } ]
                    }
                  ]
                }
              ]
            }
            """;
        var content = new StringContent(payload, Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/generate", content);
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(HttpStatusCode.OK == response.StatusCode, body);
        Assert.Contains("import xml.etree.ElementTree as ET", body);
        Assert.Contains("output.xml", body);
    }

    [Fact]
    public async Task Generate_FieldsAndGroupsBothSet_Returns400()
    {
        var payload = """
            {
              "url": "https://example.com",
              "fields": [ { "name": "Titel", "selector": "h1" } ],
              "groups": [
                { "name": "Kategorie", "selector": "section", "repeating": true, "children": [] }
              ]
            }
            """;
        var content = new StringContent(payload, Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/generate", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Contains("schließen sich aus", doc.RootElement.GetProperty("error").GetString());
    }

    // API-Mode (Issue #53): a third alternative to Fields/Groups, exclusive
    // with both. The exclusivity-only tests below never reach codegen (they
    // 400 first), so a fake, unreachable URL is fine there — see
    // Generate_ApiPayload_Returns200WithVerifiedScript below for the actual
    // end-to-end case that reaches PythonApiCodeGenerator + PythonScriptVerifier.
    private const string SampleApiPayload = """
        {
          "urlTemplate": "https://example.com/api/items?category={category}",
          "itemsPath": "data.items",
          "fields": [ { "name": "Titel", "path": "title" } ],
          "parameters": [
            { "name": "category", "source": { "kind": "staticList", "values": ["a"] } }
          ]
        }
        """;

    [Fact]
    public async Task Generate_FieldsAndApiBothSet_Returns400()
    {
        var payload = $$"""
            {
              "url": "https://example.com",
              "fields": [ { "name": "Titel", "selector": "h1" } ],
              "api": {{SampleApiPayload}}
            }
            """;
        var content = new StringContent(payload, Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/generate", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Contains("schließen sich aus", doc.RootElement.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Generate_GroupsAndApiBothSet_Returns400()
    {
        var payload = $$"""
            {
              "url": "https://example.com",
              "groups": [
                { "name": "Kategorie", "selector": "section", "repeating": true, "children": [] }
              ],
              "api": {{SampleApiPayload}}
            }
            """;
        var content = new StringContent(payload, Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/generate", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Contains("schließen sich aus", doc.RootElement.GetProperty("error").GetString());
    }

    // End-to-end through the real HTTP endpoint: engine selection resolves
    // PythonApiCodeGenerator, and the generated script is actually run
    // against a fake JSON API (real subprocess + real HTTP request, like
    // Generate_ValidConfig_Returns200WithTextPlain does for Flat-Mode).
    [Fact]
    public async Task Generate_ApiPayload_Returns200WithVerifiedScript()
    {
        using var server = new LocalTestServer(request =>
        {
            var category = request.QueryString["category"];
            var json = $$"""{ "data": { "items": [ { "title": "Item-{{category}}" } ] } }""";
            return new LocalTestServerResponse(json, "application/json");
        });

        var payload = $$"""
            {
              "url": "https://example.com",
              "api": {
                "urlTemplate": "{{server.BaseUrl}}?category={category}",
                "itemsPath": "data.items",
                "fields": [ { "name": "Titel", "path": "title" } ],
                "parameters": [
                  { "name": "category", "source": { "kind": "staticList", "values": ["a", "b"] } }
                ]
              }
            }
            """;
        var content = new StringContent(payload, Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/generate", content);
        var body = await response.Content.ReadAsStringAsync();

        Assert.True(HttpStatusCode.OK == response.StatusCode, body);
        Assert.Contains("import requests", body);
        Assert.DoesNotContain("BeautifulSoup", body);
        Assert.Contains("itertools.product", body);
    }
}
