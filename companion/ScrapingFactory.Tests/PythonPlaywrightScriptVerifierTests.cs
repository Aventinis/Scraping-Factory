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
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Item", Selector = ".item" }],
        };
        var script = Generator.Generate(plan);

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.True(result.Success);
        Assert.Null(result.Error);
        Assert.Equal(2, result.RowCount);
    }

    // Issue #83: also proves the earlier-latent playwright_navigate_step.py.j2
    // fix (page.goto(url, ...) instead of a baked-in literal) actually
    // navigates each loop iteration to the right URL, not just the first.
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
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = [$"{server.BaseUrl}a", $"{server.BaseUrl}b"] },
                new ExtractStep { Name = "Item", Selector = ".item" },
            ],
        };
        var script = Generator.Generate(plan);

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.True(result.Success, result.Error);
        Assert.Equal(3, result.RowCount);
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
                new NavigateStep { Urls = [server.BaseUrl] },
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
                    new NavigateStep { Urls = [server.BaseUrl] },
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

    // Issue #43: the same login flow as above, but via VerifyAsync's
    // extraEnvironmentVariables parameter instead of a companion-process-wide
    // Environment.SetEnvironmentVariable — proving the /generate trial run no
    // longer needs the OS environment to already carry the credentials, which
    // would be unreasonable to ask of the extension's target audience.
    [Fact]
    public async Task LoginFlow_FillsCredentialsFromExtraEnvironmentVariablesParameter()
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

        const string usernameVar = "SCRAPINGFACTORY_TEST_USERNAME_2";
        const string passwordVar = "SCRAPINGFACTORY_TEST_PASSWORD_2";
        Assert.Null(Environment.GetEnvironmentVariable(usernameVar));
        Assert.Null(Environment.GetEnvironmentVariable(passwordVar));

        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
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

        var extraEnv = new Dictionary<string, string> { [usernameVar] = "alice", [passwordVar] = "s3cret" };
        var result = await new PythonScriptVerifier().VerifyAsync(
            script, extraEnvironmentVariables: extraEnv);

        Assert.True(result.Success, result.Error);
        Assert.Equal(1, result.RowCount);
        Assert.Null(Environment.GetEnvironmentVariable(usernameVar));
        Assert.Null(Environment.GetEnvironmentVariable(passwordVar));
    }

    // Issue #88 follow-up: unlike Proxy, a FillStep genuinely can't continue
    // without its credential — but it must still fail *cleanly*, with a
    // readable message pointing at the missing variable name, instead of a
    // raw unhandled KeyError traceback (which is confusing to read from the
    // extension's own error display). Verification must still report
    // failure here — a login page's own selector never matches without a
    // successful login, so this is also covered by the ordinary
    // "no data produced" safety net, just with a better message on top.
    [Fact]
    public async Task LoginFlow_MissingCredentialEnvVar_FailsWithCleanMessageInsteadOfRawTraceback()
    {
        using var server = new LocalTestServer("""
            <html><body>
            <input id="username" type="text" />
            <button id="submit" onclick="document.body.innerHTML += '<div class=welcome>hi</div>'">Login</button>
            </body></html>
            """);

        const string usernameVar = "SCRAPINGFACTORY_TEST_USERNAME_MISSING";
        Assert.Null(Environment.GetEnvironmentVariable(usernameVar));

        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new FillStep { Selector = "#username", EnvironmentVariableName = usernameVar },
                new ClickStep { Selector = "#submit" },
                new WaitForStep { Selector = ".welcome", TimeoutMs = 2000 },
                new ExtractStep { Name = "Welcome", Selector = ".welcome" },
            ],
        };
        var script = Generator.Generate(plan);

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.False(result.Success);
        Assert.Contains(usernameVar, result.Error);
        Assert.DoesNotContain("Traceback", result.Error);
        Assert.DoesNotContain("KeyError", result.Error);
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
                new NavigateStep { Urls = [server.BaseUrl] },
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
                new NavigateStep { Urls = [server.BaseUrl] },
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
                new NavigateStep { Urls = [server.BaseUrl] },
                new ScrollStep { LoadMoreButtonSelector = "#load-more", MaxIterations = 6, WaitAfterMs = 200 },
                new ExtractStep { Name = "Item", Selector = ".item" },
            ],
        };
        var script = Generator.Generate(plan);

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.True(result.Success, result.Error);
        Assert.Equal(10, result.RowCount);
    }

    // ── Json output (Issue #86) ─────────────────────────────────────────
    // Both templates (flat/grouped) share the same import-swap/write-branch
    // shape as the Static engine's own templates — one flat and one grouped
    // case here is enough to prove the Playwright-generated script actually
    // writes valid Json too, the rest is already covered by
    // PythonScriptVerifierTests' more exhaustive Json coverage.

    [Fact]
    public async Task JsonOutput_FlatFields_Succeeds()
    {
        using var server = new LocalTestServer(
            "<html><body><ul><li class='item'>A</li><li class='item'>B</li></ul></body></html>");
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            OutputFormat = OutputFormat.Json,
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Item", Selector = ".item" }],
        };
        var script = Generator.Generate(plan);

        var result = await new PythonScriptVerifier().VerifyAsync(script, OutputFormat.Json);

        Assert.True(result.Success, result.Error);
        Assert.Equal(2, result.RowCount);
    }

    [Fact]
    public async Task JsonOutput_GroupedContainer_Succeeds()
    {
        using var server = new LocalTestServer("""
            <html><body>
            <section class="cat"><h2>Suppe</h2></section>
            <section class="cat"><h2>Salat</h2></section>
            </body></html>
            """);
        var root = new GroupNode
        {
            Name = "Kategorie",
            Selector = ".cat",
            Repeating = true,
            Children = [new DataFieldNode { Name = "Titel", Selector = "h2" }],
        };
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            OutputFormat = OutputFormat.Json,
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractGroupStep { Roots = [root] }],
        };
        var script = Generator.Generate(plan);

        var result = await new PythonScriptVerifier().VerifyAsync(script, OutputFormat.Json, includePreview: true);

        Assert.True(result.Success, result.Error);
        Assert.NotNull(result.Preview);
        Assert.Equal("Json", result.Preview.OutputFormat);
        Assert.Contains("Suppe", result.Preview.JsonSample);
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
                new NavigateStep { Urls = [server.BaseUrl] },
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
                new NavigateStep { Urls = [server.BaseUrl] },
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
                new NavigateStep { Urls = [server.BaseUrl] },
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
                new NavigateStep { Urls = [server.BaseUrl] },
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
            Steps = [new NavigateStep { Urls = [url] }, new ExtractGroupStep { Roots = [root] }],
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

    // Issue #169: browser-engine counterpart to PythonScriptVerifierTests'
    // GroupedScript_OwnTextField_ExcludesNestedBadgeText — same badge-in-
    // heading markup, proving the Playwright ElementHandle.evaluate()-based
    // own-text extraction works against the real runtime too, not just the
    // BeautifulSoup one.
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

    // ── FramePath for Action Steps (Issue #42, Phase 4) ─────────────────────
    // Mirrors LoginFlow_FillsCredentialsFromEnvironmentAndClicksSubmit above,
    // but the whole login form (inputs, button, and the resulting .welcome
    // element) lives inside an iframe — a common real-world pattern (SSO
    // widgets embedded via iframe). Exercises FillStep, ClickStep and
    // WaitForStep's FramePath together, plus ExtractStep's (from Phase 2)
    // for the final read.
    [Fact]
    public async Task LoginFlow_WithFormEmbeddedViaIframe_FillsClicksAndWaitsInsideTheFrame()
    {
        using var server = new LocalTestServer(request =>
        {
            var html = request.Url!.AbsolutePath switch
            {
                "/login" => """
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
                    """,
                _ => "<html><body><iframe id='sso' src='/login'></iframe></body></html>",
            };
            return new LocalTestServerResponse(html, "text/html; charset=utf-8");
        });

        const string usernameVar = "SCRAPINGFACTORY_TEST_USERNAME_FRAMED";
        const string passwordVar = "SCRAPINGFACTORY_TEST_PASSWORD_FRAMED";
        Environment.SetEnvironmentVariable(usernameVar, "alice");
        Environment.SetEnvironmentVariable(passwordVar, "s3cret");
        try
        {
            var plan = new ScrapingPlan
            {
                Engine = ScrapingEngine.Browser,
                Steps =
                [
                    new NavigateStep { Urls = [server.BaseUrl] },
                    new FillStep { Selector = "#username", EnvironmentVariableName = usernameVar, FramePath = ["#sso"] },
                    new FillStep { Selector = "#password", EnvironmentVariableName = passwordVar, FramePath = ["#sso"] },
                    new ClickStep { Selector = "#submit", FramePath = ["#sso"] },
                    new WaitForStep { Selector = ".welcome", TimeoutMs = 5000, FramePath = ["#sso"] },
                    new ExtractStep { Name = "Welcome", Selector = ".welcome", FramePath = ["#sso"] },
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

    // ScrollStep's FramePath, button variant — reuses Phase 1's
    // self-removing load-more-button pattern, but the button and list now
    // live inside an iframe.
    [Fact]
    public async Task ScrollStep_LoadMoreButtonInsideIframe_ClicksUntilButtonDisappears()
    {
        using var server = new LocalTestServer(request =>
        {
            var html = request.Url!.AbsolutePath switch
            {
                "/widget" => """
                    <html><body>
                    <div id="list"><div class="item">1</div></div>
                    <button id="load-more" onclick="
                      var list = document.getElementById('list');
                      var count = list.children.length;
                      var next = Math.min(count + 3, 9);
                      for (var i = count + 1; i <= next; i++) {
                        var el = document.createElement('div');
                        el.className = 'item';
                        el.textContent = String(i);
                        list.appendChild(el);
                      }
                      if (next >= 9) { this.remove(); }
                    ">Mehr laden</button>
                    </body></html>
                    """,
                _ => "<html><body><iframe id='widget' src='/widget'></iframe></body></html>",
            };
            return new LocalTestServerResponse(html, "text/html; charset=utf-8");
        });
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps =
            [
                new NavigateStep { Urls = [server.BaseUrl] },
                new ScrollStep
                {
                    LoadMoreButtonSelector = "#load-more", MaxIterations = 6, WaitAfterMs = 200, FramePath = ["#widget"],
                },
                new ExtractStep { Name = "Item", Selector = ".item", FramePath = ["#widget"] },
            ],
        };
        var script = Generator.Generate(plan);

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.True(result.Success, result.Error);
        Assert.Equal(9, result.RowCount);
    }

    // Issue #129: browser-engine counterpart to PythonScriptVerifierTests'
    // own HardeningNoResultCheck_ErrorSeverity_ZeroRows_StillFailsWithClearMessage
    // — proves EXIT_HARDENING_FAILED is whitelisted correctly against the
    // real python3 process regardless of which template generated the
    // script.
    [Fact]
    public async Task HardeningNoResultCheck_ErrorSeverity_ZeroRows_StillFailsWithClearMessage()
    {
        using var server = new LocalTestServer("<html><body><h1>Titel</h1></body></html>");
        var plan = new ScrapingPlan
        {
            Engine = ScrapingEngine.Browser,
            Steps = [new NavigateStep { Urls = [server.BaseUrl] }, new ExtractStep { Name = "Titel", Selector = ".does-not-exist" }],
            Hardening = [new NoResultCheck { Severity = HardeningSeverity.Error }],
        };
        var script = Generator.Generate(plan);

        var result = await new PythonScriptVerifier().VerifyAsync(script);

        Assert.False(result.Success);
        Assert.Contains("no data", result.Error);
        Assert.DoesNotContain("exited with an error", result.Error);
    }
}
