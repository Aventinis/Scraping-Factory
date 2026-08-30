using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Real end-to-end tests for the Browser engine: spawns an actual python3
// subprocess that launches a real Chromium via Playwright against
// LocalTestServer — the same "prove the exact artifact works" philosophy
// as PythonScriptVerifierTests, just for the Playwright-generated script.
// Requires playwright + a downloaded Chromium build on the machine running
// the tests (see CLAUDE.md runtime prerequisites).
public class PythonPlaywrightScriptVerifierTests
{
    private static readonly PythonPlaywrightCodeGenerator Generator = new();

    [Fact]
    public async Task ScriptThatFindsData_Succeeds()
    {
        using var server = new LocalTestServer(
            "<html><body><ul><li class='item'>A</li><li class='item'>B</li></ul></body></html>");
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps = [new NavigateStep { Url = server.BaseUrl }, new ExtractStep { Name = "Item", Selector = ".item" }],
        };
        var script = Generator.Generate(plan);

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.True(result.Success);
        Assert.Null(result.Error);
        Assert.Equal(2, result.RowCount);
    }

    // The whole point of the Browser engine: content inserted by JavaScript
    // after the initial page load. A requests+BeautifulSoup script (Static
    // engine) could never see this — it never runs the <script> tag.
    [Fact]
    public async Task WaitForStep_ExtractsContentInsertedByJavaScriptAfterLoad()
    {
        using var server = new LocalTestServer("""
            <html><body>
            <div id="container"></div>
            <script>
              setTimeout(function () {
                var el = document.createElement('div');
                el.className = 'item';
                el.textContent = 'Loaded';
                document.getElementById('container').appendChild(el);
              }, 1500);
            </script>
            </body></html>
            """);
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Url = server.BaseUrl },
                new WaitForStep { Selector = ".item", TimeoutMs = 5000 },
                new ExtractStep { Name = "Item", Selector = ".item" },
            ],
        };
        var script = Generator.Generate(plan);

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.True(result.Success);
        Assert.Equal(1, result.RowCount);
    }

    // Proves the actual point of FillStep/ClickStep: a login flow where
    // credentials are sourced from environment variables at runtime and
    // never appear literally in the generated script. The "backend" here is
    // pure client-side JS reacting to the click (LocalTestServer always
    // serves the same page regardless of method/path), which is enough to
    // prove fill + click + wait-for-success actually happen in order.
    [Fact]
    public async Task LoginFlow_FillsCredentialsFromEnvironmentAndClicksSubmit()
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

        const string usernameVar = "SCRAPINGFACTORY_TEST_USERNAME";
        const string passwordVar = "SCRAPINGFACTORY_TEST_PASSWORD";
        Environment.SetEnvironmentVariable(usernameVar, "alice");
        Environment.SetEnvironmentVariable(passwordVar, "s3cret");
        try
        {
            var plan = new ScrapingPlan
            {
                Engine = ScrapingEngine.Browser,
                Steps =
                [
                    new NavigateStep { Url = server.BaseUrl },
                    new FillStep { Selector = "#username", EnvironmentVariableName = usernameVar },
                    new FillStep { Selector = "#password", EnvironmentVariableName = passwordVar },
                    new ClickStep { Selector = "#submit" },
                    new WaitForStep { Selector = ".welcome", TimeoutMs = 5000 },
                    new ExtractStep { Name = "Welcome", Selector = ".welcome" },
                ],
            };
            var script = Generator.Generate(plan);
            Assert.DoesNotContain("alice", script);
            Assert.DoesNotContain("s3cret", script);

            var result = await new PythonScriptVerifier().VerifyAsync(script);

            Assert.True(result.Success, result.Error);
            Assert.Equal(1, result.RowCount);
        }
        finally
        {
            Environment.SetEnvironmentVariable(usernameVar, null);
            Environment.SetEnvironmentVariable(passwordVar, null);
        }
    }

    // Proves ScrollStep's actual point: content that only appears after
    // repeated scrolling (infinite scroll), not just a single WaitForStep's
    // worth of async-loaded content. The page loads 5 more .item elements
    // per scroll event, up to 20 total — a plain single-pass extraction
    // would only ever see the initial 5.
    [Fact]
    public async Task ScrollStep_InfiniteScroll_ExtractsAllItemsAcrossMultipleRounds()
    {
        using var server = new LocalTestServer("""
            <html><body>
            <div id="list">
              <div class="item">1</div>
              <div class="item">2</div>
              <div class="item">3</div>
              <div class="item">4</div>
              <div class="item">5</div>
            </div>
            <div style="height: 2000px;"></div>
            <script>
              var total = 20;
              var loaded = 5;
              window.addEventListener('scroll', function () {
                if (loaded >= total) return;
                var list = document.getElementById('list');
                var next = Math.min(loaded + 5, total);
                for (var i = loaded + 1; i <= next; i++) {
                  var el = document.createElement('div');
                  el.className = 'item';
                  el.textContent = String(i);
                  list.appendChild(el);
                }
                loaded = next;
              });
            </script>
            </body></html>
            """);
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Url = server.BaseUrl },
                new ScrollStep { MaxIterations = 10, WaitAfterMs = 300 },
                new ExtractStep { Name = "Item", Selector = ".item" },
            ],
        };
        var script = Generator.Generate(plan);

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.True(result.Success, result.Error);
        Assert.Equal(20, result.RowCount);
    }

    // Covers ContainerSelector specifically: a fixed-height, independently
    // scrollable box (its own scrollbar, not the page's). Regression test
    // for a real bug found via manual testing — the stop-condition check
    // originally always measured document.body.scrollHeight, which never
    // changes when a bounded sub-container grows internally, so scrolling
    // stopped after the very first round.
    [Fact]
    public async Task ScrollStep_ContainerSelector_ExtractsAllItemsFromScrollableBox()
    {
        using var server = new LocalTestServer("""
            <html><body>
            <div id="box" style="max-height: 40px; overflow-y: auto;">
              <div class="item">1</div>
              <div class="item">2</div>
              <div class="item">3</div>
            </div>
            <script>
              var total = 15;
              var loaded = 3;
              var box = document.getElementById('box');
              box.addEventListener('scroll', function () {
                if (loaded >= total) return;
                var next = Math.min(loaded + 3, total);
                for (var i = loaded + 1; i <= next; i++) {
                  var el = document.createElement('div');
                  el.className = 'item';
                  el.textContent = String(i);
                  box.appendChild(el);
                }
                loaded = next;
              });
            </script>
            </body></html>
            """);
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Url = server.BaseUrl },
                new ScrollStep { ContainerSelector = "#box", MaxIterations = 10, WaitAfterMs = 300 },
                new ExtractStep { Name = "Item", Selector = ".item" },
            ],
        };
        var script = Generator.Generate(plan);

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.True(result.Success, result.Error);
        Assert.Equal(15, result.RowCount);
    }

    // Covers the "load more" button variant of ScrollStep: the button
    // appends more items per click and removes itself once everything is
    // loaded — proving the generated script tolerates the button
    // disappearing (page.query_selector returning None) instead of erroring.
    [Fact]
    public async Task ScrollStep_LoadMoreButton_ClicksUntilButtonDisappears()
    {
        using var server = new LocalTestServer("""
            <html><body>
            <div id="list"><div class="item">1</div></div>
            <button id="load-more" onclick="
              var list = document.getElementById('list');
              var count = list.children.length;
              var next = Math.min(count + 3, 10);
              for (var i = count + 1; i <= next; i++) {
                var el = document.createElement('div');
                el.className = 'item';
                el.textContent = String(i);
                list.appendChild(el);
              }
              if (next >= 10) { this.remove(); }
            ">Mehr laden</button>
            </body></html>
            """);
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Url = server.BaseUrl },
                new ScrollStep { LoadMoreButtonSelector = "#load-more", MaxIterations = 6, WaitAfterMs = 200 },
                new ExtractStep { Name = "Item", Selector = ".item" },
            ],
        };
        var script = Generator.Generate(plan);

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.True(result.Success, result.Error);
        Assert.Equal(10, result.RowCount);
    }

    // ── FramePath / Shadow DOM (Issue #42) ──────────────────────────────────

    // Regression/verification test for Spike B's finding: Playwright's own
    // selector engine pierces open shadow roots automatically for a plain
    // CSS selector passed to query_selector_all — no FramePath, no codegen
    // change, this should just work already.
    [Fact]
    public async Task ShadowDom_ExtractsDataWithoutFramePath()
    {
        using var server = new LocalTestServer("""
            <html><body>
            <div id="host"></div>
            <script>
              var host = document.getElementById('host');
              var shadow = host.attachShadow({ mode: 'open' });
              var el = document.createElement('div');
              el.className = 'price';
              el.textContent = '17';
              shadow.appendChild(el);
            </script>
            </body></html>
            """);
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Url = server.BaseUrl },
                new ExtractStep { Name = "Preis", Selector = ".price" },
            ],
        };
        var script = Generator.Generate(plan);

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, result.RowCount);
    }

    [Fact]
    public async Task FramePath_SingleIframe_ExtractsDataFromInsideIframe()
    {
        using var server = new LocalTestServer(request =>
        {
            var html = request.Url!.AbsolutePath switch
            {
                "/inner" => "<html><body><div class='price'>42</div></body></html>",
                _ => "<html><body><iframe id='outer' src='/inner'></iframe></body></html>",
            };
            return new LocalTestServerResponse(html, "text/html; charset=utf-8");
        });
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Url = server.BaseUrl },
                new ExtractStep { Name = "Preis", Selector = ".price", FramePath = ["#outer"] },
            ],
        };
        var script = Generator.Generate(plan);

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, result.RowCount);
    }

    [Fact]
    public async Task FramePath_NestedIframe_ExtractsDataFromDoublyNestedIframe()
    {
        using var server = new LocalTestServer(request =>
        {
            var html = request.Url!.AbsolutePath switch
            {
                "/inner" => "<html><body><div class='price'>99</div></body></html>",
                "/mid" => "<html><body><iframe id='inner-frame' src='/inner'></iframe></body></html>",
                _ => "<html><body><iframe id='outer' src='/mid'></iframe></body></html>",
            };
            return new LocalTestServerResponse(html, "text/html; charset=utf-8");
        });
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Url = server.BaseUrl },
                new ExtractStep { Name = "Preis", Selector = ".price", FramePath = ["#outer", "#inner-frame"] },
            ],
        };
        var script = Generator.Generate(plan);

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, result.RowCount);
    }

    // Extracting a mix of framed and non-framed fields in the same request —
    // proves FRAME_PATHS.get(name) correctly falls back to the plain
    // query_selector_all path per-field, not plan-wide.
    [Fact]
    public async Task FramePath_MixedFramedAndUnframedFields_ExtractsBoth()
    {
        using var server = new LocalTestServer(request =>
        {
            var html = request.Url!.AbsolutePath switch
            {
                "/inner" => "<html><body><div class='price'>7</div></body></html>",
                _ => "<html><body><h1 class='title'>Top-Level Titel</h1><iframe id='outer' src='/inner'></iframe></body></html>",
            };
            return new LocalTestServerResponse(html, "text/html; charset=utf-8");
        });
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Url = server.BaseUrl },
                new ExtractStep { Name = "Titel", Selector = ".title" },
                new ExtractStep { Name = "Preis", Selector = ".price", FramePath = ["#outer"] },
            ],
        };
        var script = Generator.Generate(plan);

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, result.RowCount);
    }

    // ── Container-Mode FramePath (Issue #42, Phase 3) ───────────────────────

    private static string GenerateGroupedScript(string url, GroupNode root)
    {
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps = [new NavigateStep { Url = url }, new ExtractGroupStep { Roots = [root] }],
        };
        return Generator.Generate(plan);
    }

    // The group's own selector matches inside an iframe — its children (not
    // individually framed) are extracted relative to each matched instance,
    // exactly as if the group had never been framed at all, since a matched
    // instance is converted to an ElementHandle right after resolution (see
    // playwright_scraper_grouped.py.j2's _resolve_group_matches).
    [Fact]
    public async Task FramedGroup_ExtractsChildrenFromWithinTheIframe()
    {
        using var server = new LocalTestServer(request =>
        {
            var html = request.Url!.AbsolutePath switch
            {
                "/inner" => """
                    <html><body>
                    <section class="cat"><h2>Suppe</h2></section>
                    <section class="cat"><h2>Salat</h2></section>
                    </body></html>
                    """,
                _ => "<html><body><iframe id='widget' src='/inner'></iframe></body></html>",
            };
            return new LocalTestServerResponse(html, "text/html; charset=utf-8");
        });
        var root = new GroupNode
        {
            Name = "Kategorie",
            Selector = ".cat",
            Repeating = true,
            FramePath = ["#widget"],
            Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }],
        };
        var script = GenerateGroupedScript(server.BaseUrl, root);

        var result = await new PythonScriptVerifier().VerifyAsync(script, OutputFormat.Xml);

        Assert.True(result.Success, result.Error);
        // 2 <Kategorie> + 2 <Titel> = 4
        Assert.Equal(4, result.RowCount);
    }

    // A group repeats on the top-level page (unframed, existing behavior),
    // but one of its child fields is sourced from a single, separate iframe
    // widget shared across every instance (e.g. a currency rate shown once,
    // applied to every row) — proves per-node FramePath, not per-tree: the
    // plain sibling field still resolves against each matched instance,
    // while the framed sibling always resolves the same absolute path
    // regardless of which instance is currently being processed.
    [Fact]
    public async Task MixedFramedAndUnframedSiblingFields_ExtractsBoth()
    {
        using var server = new LocalTestServer(request =>
        {
            var html = request.Url!.AbsolutePath switch
            {
                "/rate" => "<html><body><div class='value'>1,08 USD</div></body></html>",
                _ => """
                    <html><body>
                    <section class="cat"><h2>Suppe</h2></section>
                    <section class="cat"><h2>Salat</h2></section>
                    <iframe id="rate" src="/rate"></iframe>
                    </body></html>
                    """,
            };
            return new LocalTestServerResponse(html, "text/html; charset=utf-8");
        });
        var root = new GroupNode
        {
            Name = "Kategorie",
            Selector = ".cat",
            Repeating = true,
            Children =
            [
                new DataFieldNode { Name = "Titel", Selector = "h2" },
                new DataFieldNode { Name = "Kurs", Selector = ".value", FramePath = ["#rate"] },
            ],
        };
        var script = GenerateGroupedScript(server.BaseUrl, root);

        var result = await new PythonScriptVerifier().VerifyAsync(script, OutputFormat.Xml);

        Assert.True(result.Success, result.Error);
        // 2 <Kategorie> + 2 <Titel> + 2 <Kurs> = 6
        Assert.Equal(6, result.RowCount);
    }
}
