using ScrapingFactory.Compiler.Backends.Python;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #267: a Click step whose selector matches several elements no longer
// aborts with Playwright's "strict mode violation" — First (default)/Last
// click one match, All clicks every match in order.
public class ClickTargetTests
{
    private static ScrapingPlan Plan(string url, ClickStep click) => new()
    {
        Engine = ScrapingEngine.Browser,
        Steps =
        [
            new NavigateStep { Urls = [url] },
            click,
            new ExtractStep { Name = "Open", Selector = "li.open" },
        ],
    };

    // Three identical toggles, each revealing its own entry when clicked.
    private const string Page = "<html><body>"
        + "<button class='t' data-n='1' onclick=\"this.insertAdjacentHTML('afterend','<li class=open>1</li>')\">more</button>"
        + "<button class='t' data-n='2' onclick=\"this.insertAdjacentHTML('afterend','<li class=open>2</li>')\">more</button>"
        + "<button class='t' data-n='3' onclick=\"this.insertAdjacentHTML('afterend','<li class=open>3</li>')\">more</button>"
        + "</body></html>";

    private static async Task<string[]> RunAsync(ClickStep click)
    {
        using var server = new LocalTestServer(Page);
        var script = new PythonPlaywrightCodeGenerator().Generate(Plan(server.BaseUrl, click));
        var result = await new PythonScriptVerifier().VerifyAsync(script, includeOutputFile: true);
        Assert.True(result.Success, result.Error);
        return result.OutputFileContent!.Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(l => l.Trim()).Skip(1).ToArray();
    }

    [Fact]
    public async Task DefaultTarget_ClicksTheFirstMatch_InsteadOfFailingOnSeveral() =>
        Assert.Equal(["1"], await RunAsync(new ClickStep { Selector = "button.t" }));

    [Fact]
    public async Task LastTarget_ClicksTheLastMatch() =>
        Assert.Equal(["3"], await RunAsync(new ClickStep { Selector = "button.t", Target = ClickTarget.Last }));

    [Fact]
    public async Task AllTarget_ClicksEveryMatchInOrder() =>
        Assert.Equal(["1", "2", "3"], await RunAsync(new ClickStep { Selector = "button.t", Target = ClickTarget.All, WaitAfterMs = 50 }));

    [Fact]
    public async Task AllTarget_WithNoMatch_FailsLikeAnyOtherMissingClickTarget()
    {
        using var server = new LocalTestServer("<html><body><p>nothing</p></body></html>");
        var script = new PythonPlaywrightCodeGenerator().Generate(Plan(server.BaseUrl, new ClickStep { Selector = "button.t", Target = ClickTarget.All }));
        var result = await new PythonScriptVerifier(timeout: TimeSpan.FromSeconds(60)).VerifyAsync(script);
        Assert.False(result.Success);
    }

    [Fact]
    public void RenderedScript_KeepsTheTargetInTheClickCall()
    {
        var generator = new PythonPlaywrightCodeGenerator();
        Assert.Contains(".first.click()", generator.Generate(Plan("https://example.com", new ClickStep { Selector = "a" })));
        Assert.Contains(".last.click()", generator.Generate(Plan("https://example.com", new ClickStep { Selector = "a", Target = ClickTarget.Last })));
        var all = generator.Generate(Plan("https://example.com", new ClickStep { Selector = "a", Target = ClickTarget.All, WaitAfterMs = 400 }));
        Assert.Contains("for _click_index in range(_click_targets.count()):", all);
        Assert.Contains("page.wait_for_timeout(400)", all);
    }

    [Fact]
    public void Validate_NegativeWaitAfter_Fails()
    {
        var result = ScrapingPlanValidator.Validate(Plan("https://example.com", new ClickStep { Selector = "a", Target = ClickTarget.All, WaitAfterMs = -1 }));
        Assert.False(result.Success);
        Assert.Contains("WaitAfterMs", result.Error);
    }

    [Fact]
    public void WireFormat_DefaultsToFirst_AndParsesTheTargetName()
    {
        var options = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web);
        options.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
        var plain = System.Text.Json.JsonSerializer.Deserialize<ScrapingConfig>(
            """{"url":"https://example.com","engine":"Browser","fields":[{"name":"a","selector":"h1"}],"browserActions":[{"kind":"click","selector":"b"}]}""", options)!;
        Assert.Equal(ClickTarget.First, ((ClickAction)plain.BrowserActions![0]).Target);
        var all = System.Text.Json.JsonSerializer.Deserialize<ScrapingConfig>(
            """{"url":"https://example.com","engine":"Browser","fields":[{"name":"a","selector":"h1"}],"browserActions":[{"kind":"click","selector":"b","target":"All","waitAfterMs":100}]}""", options)!;
        var click = (ClickAction)all.BrowserActions![0];
        Assert.Equal(ClickTarget.All, click.Target);
        Assert.Equal(100, click.WaitAfterMs);
    }
}
