using System.Text.Json.Nodes;

namespace ScrapingFactory.Tests;

// The feature cases of the snapshot matrix; see SnapshotCases.cs.
public static partial class SnapshotCases
{
    // ---- Reusable feature fragments -----------------------------------------------------------
    private const string HardeningAll = """
        {"hardening":[
          {"kind":"noResult","severity":"Warning"},
          {"kind":"nullRate","severity":"Error","fieldName":"Price","threshold":0.5},
          {"kind":"baseline","severity":"Warning","dropThreshold":0.2},
          {"kind":"blocking","severity":"Warning","minBodyLength":1000,"blockPhrases":["Access Denied","Please verify you are human"]},
          {"kind":"requiredFields","severity":"Warning","fieldNames":["Title"]}]}
        """;

    private const string ChangeDetectionEmail = """
        {"changeDetection":{"notify":"Email","email":{
          "smtpHostEnvVar":"SMTP_HOST","smtpPortEnvVar":"SMTP_PORT","smtpUsernameEnvVar":"SMTP_USER",
          "smtpPasswordEnvVar":"SMTP_PASSWORD","fromEnvVar":"MAIL_FROM","toEnvVar":"MAIL_TO"}}}
        """;

    private const string ChangeDetectionWebhook = """{"changeDetection":{"notify":"Webhook","webhook":{"urlEnvVar":"WEBHOOK_URL"}}}""";

    private const string RequestHeaders = """
        {"headers":[
          {"name":"Accept-Language","value":"de-CH"},
          {"name":"Authorization","environmentVariableName":"API_TOKEN"},
          {"name":"User-Agent","value":"my-scraper/1.0"}]}
        """;

    private const string Proxy = """{"proxy":{"environmentVariableName":"PROXY_LIST"}}""";
    private const string RequestDelay = """{"requestDelay":{"minMs":1000,"maxMs":3000}}""";
    private const string Retry = """{"retry":{"maxAttempts":4,"delayMs":1500,"exponential":true,"retryOnStatusCodes":[429,503]}}""";
    private const string DedupIncrementalDelta = """{"deduplication":{"keyFields":["Title","Price"],"incremental":true,"incrementalOutput":"Delta","retention":{"kind":"MaxCount","value":5000}}}""";
    private const string DedupIncrementalAppend = """{"deduplication":{"keyFields":["Title"],"incremental":true,"incrementalOutput":"Append","retention":{"kind":"MaxAge","value":30}}}""";
    private const string NextLink = """{"pagination":{"kind":"nextLink","nextLinkSelector":"a.next","maxPages":5}}""";
    private const string PageNumber = """{"pagination":{"kind":"pageNumber","urlTemplate":"{url}?page={page}","maxPages":8}}""";
    private const string DiscoveredUrls = """{"discoveredUrls":{"pageUrl":"https://example.test/categories","linkSelector":"nav.categories a","maxUrls":25}}""";

    // ---- Output formats and file names --------------------------------------------------------
    private static void RegisterOutputFormats()
    {
        Add("static-flat+json", Flat, """{"outputFormat":"Json"}""");
        Add("static-flat+sqlite", Flat, """{"outputFormat":"Sqlite"}""");
        Add("static-flat+xlsx", Flat, """{"outputFormat":"Xlsx"}""");
        Add("static-flat+file-names", Flat, """{"scriptFileName":"menu_scraper","outputFileName":"menu_output"}""");
        Add("static-container+json", Container, """{"outputFormat":"Json"}""");
        Add("static-container+sqlite-flattened", Container, """{"outputFormat":"Sqlite"}""");
        Add("static-container+xlsx-flattened", Container, """{"outputFormat":"Xlsx"}""");
        Add("api-flat+json", ApiFlat, """{"outputFormat":"Json"}""");
        Add("api-flat+sqlite", ApiFlat, """{"outputFormat":"Sqlite"}""");
        Add("api-tree+json", ApiTree, """{"outputFormat":"Json"}""");
    }

    // ---- Static engine, flat ------------------------------------------------------------------
    private static void RegisterStaticFlat()
    {
        Add("static-flat+additional-urls", Flat, """{"additionalUrls":["https://example.test/list?page=2","https://example.test/list?page=3"]}""");
        Add("static-flat+pagination-next-link", Flat, NextLink);
        Add("static-flat+pagination-page-number", Flat, PageNumber);
        Add("static-flat+discovered-urls", Flat, DiscoveredUrls);
        Add("static-flat+preflight", Flat, """{"preflight":true}""");
        Add("static-flat+proxy", Flat, Proxy);
        Add("static-flat+request-delay-range", Flat, RequestDelay);
        Add("static-flat+request-delay-fixed", Flat, """{"requestDelay":{"minMs":2000,"maxMs":2000}}""");
        Add("static-flat+retry-defaults", Flat, """{"retry":{}}""");
        Add("static-flat+retry-custom", Flat, Retry);
        Add("static-flat+robots-delay", Flat, """{"respectRobotsDelay":true}""");
        Add("static-flat+robots-disallow-skip", Flat, """{"robotsDisallow":{"action":"Skip"}}""");
        Add("static-flat+robots-disallow-warn", Flat, """{"robotsDisallow":{"action":"Warn"}}""");
        Add("static-flat+robots-disallow-abort", Flat, """{"robotsDisallow":{"action":"Abort"}}""");
        Add("static-flat+dedup-within-run", Flat, """{"deduplication":{"keyFields":["Title"]}}""");
        Add("static-flat+dedup-incremental-delta", Flat, DedupIncrementalDelta);
        Add("static-flat+dedup-incremental-append", Flat, DedupIncrementalAppend);
        Add("static-flat+append-output", Flat, """{"appendOutput":true}""");
        Add("static-flat+headers", Flat, RequestHeaders);
        Add("static-flat+hardening-all", Flat, HardeningAll);
        Add("static-flat+hardening-warnings-only", Flat, """{"hardening":[{"kind":"noResult","severity":"Warning"},{"kind":"requiredFields","severity":"Warning","fieldNames":["Title","Price"]}]}""");
        Add("static-flat+change-detection-email", Flat, ChangeDetectionEmail);
        Add("static-flat+change-detection-webhook", Flat, ChangeDetectionWebhook);
        Add("static-flat+external-config", Flat, """{"externalConfig":true}""");

        Add("static-flat+text-filter", Flat, """
            {"fields":[
              {"name":"Title","selector":"h2.title"},
              {"name":"Next","selector":"a.pager:contains(\"Next page\")","attribute":"href"},
              {"name":"Cart","selector":"button:contains('Add to cart')"}]}
            """);

        Add("browser-flat+frame-path-fields", Flat, """
            {"engine":"Browser","fields":[
              {"name":"Title","selector":"h2.title"},
              {"name":"Stock","selector":"span.stock","framePath":["iframe#shop","iframe.widget"]}]}
            """);

        Add("static-flat+transforms-text", Flat, """
            {"fields":[
              {"name":"Title","selector":"h2.title","transforms":[{"kind":"trim"},{"kind":"replace","find":"Sale:","replacement":""}]},
              {"name":"Price","selector":"span.price","transforms":[{"kind":"trim"},{"kind":"regexExtract","pattern":"([0-9,.]+)","group":1},{"kind":"toNumber"}]},
              {"name":"SKU","selector":"span.sku","transforms":[{"kind":"regexExtract","pattern":"[0-9]+"}]}]}
            """);

        Add("static-flat+transforms-typed", Flat, """
            {"fields":[
              {"name":"Stock","selector":"span.stock","transforms":[{"kind":"toInteger","onError":"UseDefault","defaultValue":"0"}]},
              {"name":"Available","selector":"span.available","transforms":[{"kind":"toBoolean","onError":"KeepOriginal"}]},
              {"name":"Released","selector":"time.released","transforms":[{"kind":"toDate","sourceFormat":"{dd}.{mm}.{yyyy}","onError":"UseDefault","defaultValue":"1970-01-01"}]},
              {"name":"Price","selector":"span.price","transforms":[{"kind":"toCurrency","format":"1.234,56","onError":"KeepOriginal"}]}]}
            """);

        Add("static-flat+derived-fields", Flat, """
            {"fields":[
              {"name":"First","selector":"span.first","hiddenFromOutput":true},
              {"name":"Last","selector":"span.last","hiddenFromOutput":true},
              {"name":"Full","transforms":[{"kind":"combineFields","sourceFieldNames":["First","Last"],"separator":" "}]},
              {"name":"Initial","transforms":[{"kind":"splitField","sourceFieldName":"First","separator":"-","index":0}]}]}
            """);

        Add("static-flat+download", Flat, """
            {"fields":[
              {"name":"Title","selector":"h2.title"},
              {"name":"Image","selector":"img.product","attribute":"src","download":true,"maxDownloadSizeBytes":5242880,"allowedContentTypes":["image/jpeg","image/png"]},
              {"name":"Manual","selector":"a.manual","attribute":"href","download":true}]}
            """);

        Add("static-flat+output-blueprint", Flat, """
            {"outputBlueprint":{"blueprintId":1,"schemaKind":"Flat","fields":[
              {"targetField":"product","sourceField":"Title"},
              {"targetField":"price_eur","sourceField":"Price"}]}}
            """);
    }

    // ---- Browser engine, flat -----------------------------------------------------------------
    private static void RegisterBrowserFlat()
    {
        var b = WithBrowser(Flat);
        Add("browser-flat+login-flow", b, $$"""{"browserActions":{{LoginActions}}}""");
        Add("browser-flat+login-flow-persistent-session", b, $$"""{"browserActions":{{LoginActions}},"persistentSession":true}""");
        Add("browser-flat+scroll", b, """
            {"browserActions":[
              {"kind":"scroll","maxIterations":12,"waitAfterMs":800},
              {"kind":"scroll","containerSelector":"div.feed","loadMoreButtonSelector":"button.more","maxIterations":5,"waitAfterMs":1000,"scrollStepPx":400}]}
            """);
        Add("browser-flat+click-targets", b, """
            {"browserActions":[
              {"kind":"click","selector":"button.cookies"},
              {"kind":"click","selector":"button.expand","target":"Last"},
              {"kind":"click","selector":"a.toggle","target":"All","waitAfterMs":300}]}
            """);
        Add("browser-flat+frame-actions", b, """
            {"browserActions":[
              {"kind":"waitFor","selector":"#consent","timeoutMs":8000,"framePath":["iframe#cmp"]},
              {"kind":"click","selector":"button.accept","framePath":["iframe#cmp"]},
              {"kind":"fill","selector":"#q","environmentVariableName":"SEARCH_TERM","framePath":["iframe#search"]}]}
            """);
        Add("browser-flat+pagination-next-link", b, NextLink);
        Add("browser-flat+pagination-page-number", b, PageNumber);
        Add("browser-flat+preflight", b, """{"preflight":true}""");
        Add("browser-flat+discovered-urls", b, DiscoveredUrls);
        Add("browser-flat+headers", b, RequestHeaders);
        Add("browser-flat+proxy", b, Proxy);
        Add("browser-flat+retry", b, Retry);
        Add("browser-flat+request-delay", b, RequestDelay);
        Add("browser-flat+robots-disallow-abort", b, """{"respectRobotsDelay":true,"robotsDisallow":{"action":"Abort"}}""");
        Add("browser-flat+hardening-all", b, HardeningAll);
        Add("browser-flat+dedup-incremental", b, DedupIncrementalDelta);
        Add("browser-flat+append-output", b, """{"appendOutput":true}""");
        Add("browser-flat+change-detection", b, ChangeDetectionEmail);
        Add("browser-flat+external-config", b, """{"externalConfig":true}""");
        Add("browser-flat+download", b, """
            {"fields":[
              {"name":"Title","selector":"h2.title"},
              {"name":"Image","selector":"img.product","attribute":"src","download":true,"maxDownloadSizeBytes":1048576,"allowedContentTypes":["image/png"]}]}
            """);
        Add("browser-flat+text-filter", b, """{"fields":[{"name":"Next","selector":"a.pager:contains(\"Next page\")","attribute":"href"}]}""");
        Add("browser-flat+transforms-and-derived-fields", b, """
            {"fields":[
              {"name":"Price","selector":"span.price","transforms":[{"kind":"trim"},{"kind":"toCurrency","format":"1,234.56"}]},
              {"name":"First","selector":"span.first","hiddenFromOutput":true},
              {"name":"Full","transforms":[{"kind":"combineFields","sourceFieldNames":["First","Price"],"separator":" - "}]}]}
            """);
    }

    // ---- Containers ---------------------------------------------------------------------------
    private static void RegisterContainer()
    {
        var b = WithBrowser(Container);
        Add("static-container+field-modes", Container, """
            {"groups":[{"name":"Product","selector":"li.product","repeating":true,"children":[
              {"name":"Title","selector":"h3","mode":"Text"},
              {"name":"Link","selector":"a","mode":"Attribute","attribute":"href"},
              {"name":"InStock","selector":".stock","mode":"Exists"},
              {"name":"Label","selector":"h3","mode":"OwnText"},
              {"name":"Gallery","selector":".gallery","repeating":false,"children":[
                {"name":"Image","selector":"img","mode":"Attribute","attribute":"src"}]}]}]}
            """);
        Add("browser-container+single-root-and-frame-path", Container, """
            {"engine":"Browser","groups":[
              {"name":"Header","selector":"header","repeating":false,"children":[{"name":"Title","selector":"h1","mode":"Text"}]},
              {"name":"Widget","selector":"div.widget","repeating":true,"framePath":["iframe#shop"],"children":[{"name":"Name","selector":"h4","mode":"Text","framePath":["iframe#shop"]}]}]}
            """);
        Add("static-container+hardening-all", Container, """
            {"hardening":[
              {"kind":"noResult","severity":"Warning"},
              {"kind":"nullRate","severity":"Error","fieldName":"Price","threshold":0.4},
              {"kind":"baseline","severity":"Error","dropThreshold":0.25},
              {"kind":"blocking","severity":"Warning","blockPhrases":["Access Denied"]},
              {"kind":"requiredFields","severity":"Error","fieldNames":["Name","Price"]}]}
            """);
        Add("static-container+dedup", Container, """{"deduplication":{"keyFields":["Name"],"incremental":true,"incrementalOutput":"Append","retention":{"kind":"MaxCount","value":1000}}}""");
        Add("static-container+output-blueprint-flat", Container, """
            {"outputBlueprint":{"blueprintId":2,"schemaKind":"Flat","fields":[
              {"targetField":"category","sourceField":"Heading"},
              {"targetField":"dish","sourceField":"Name"},
              {"targetField":"price","sourceField":"Price"}]}}
            """);
        Add("static-container+output-blueprint-tree", Container, """
            {"outputBlueprint":{"blueprintId":3,"schemaKind":"Tree","tree":[
              {"name":"Menu","children":[
                {"name":"title","sourceField":"Heading"},
                {"name":"Entry","children":[
                  {"name":"label","sourceField":"Name"},
                  {"name":"amount","sourceField":"Price"}]}]}]}}
            """);
        Add("static-container+download", Container, """
            {"groups":[{"name":"Item","selector":"li.item","repeating":true,"children":[
              {"name":"Title","selector":"h3","mode":"Text"},
              {"name":"Image","selector":"img","mode":"Attribute","attribute":"src","download":true,"maxDownloadSizeBytes":2097152,"allowedContentTypes":["image/jpeg"]}]}]}
            """);
        Add("static-container+transforms-and-derived-fields", Container, """
            {"groups":[{"name":"Dish","selector":"li.dish","repeating":true,"children":[
              {"name":"First","selector":".first","mode":"Text","hiddenFromOutput":true},
              {"name":"Price","selector":".price","mode":"Text","transforms":[{"kind":"trim"},{"kind":"toCurrency","format":"1.234,56","onError":"UseDefault","defaultValue":"0"}]},
              {"name":"Combined","transforms":[{"kind":"combineFields","sourceFieldNames":["First","Price"],"separator":": "}]},
              {"name":"Part","transforms":[{"kind":"splitField","sourceFieldName":"First","separator":" ","index":1}]}]}]}
            """);
        Add("static-container+pagination-and-urls", Container, """
            {"additionalUrls":["https://example.test/menu/lunch"],"pagination":{"kind":"nextLink","nextLinkSelector":"a.next","maxPages":4},"preflight":true}
            """);
        Add("static-container+append-and-external-config", Container, """{"appendOutput":true,"externalConfig":true}""");
        Add("static-container+change-detection", Container, ChangeDetectionWebhook);
        Add("static-container+proxy-retry-delay-headers", Container, """
            {"proxy":{"environmentVariableName":"PROXY_LIST"},"retry":{"maxAttempts":3},"requestDelay":{"minMs":500,"maxMs":1500},"headers":[{"name":"Referer","value":"https://example.test/"}],"robotsDisallow":{"action":"Skip"}}
            """);
        Add("browser-container+login-persistent-session", b, $$"""{"browserActions":{{LoginActions}},"persistentSession":true}""");
        Add("browser-container+scroll-and-pagination", b, """
            {"browserActions":[{"kind":"scroll","loadMoreButtonSelector":"button.more","maxIterations":6,"waitAfterMs":700}],"pagination":{"kind":"pageNumber","urlTemplate":"{url}?page={page}","maxPages":3}}
            """);
        Add("browser-container+hardening-dedup-download", b, """
            {"groups":[{"name":"Item","selector":"li.item","repeating":true,"children":[
                {"name":"Title","selector":"h3","mode":"Text"},
                {"name":"Image","selector":"img","mode":"Attribute","attribute":"src","download":true}]}],
             "hardening":[{"kind":"noResult","severity":"Error"},{"kind":"requiredFields","severity":"Warning","fieldNames":["Title"]}],
             "deduplication":{"keyFields":["Title"]}}
            """);
        Add("browser-container+discovered-urls-and-headers", b, $$"""
            {"discoveredUrls":{"pageUrl":"https://example.test/categories","linkSelector":"nav a","maxUrls":10},"headers":[{"name":"Accept-Language","value":"fr"}]}
            """);
    }
}
