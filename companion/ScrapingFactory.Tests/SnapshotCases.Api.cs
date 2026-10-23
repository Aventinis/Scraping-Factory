namespace ScrapingFactory.Tests;

// The API, Blocks, Combined and interaction cases of the snapshot matrix; see SnapshotCases.cs.
public static partial class SnapshotCases
{
    private static string ApiWith(string apiPatchJson)
    {
        // Merges extra properties into the base ApiFlat "api" object.
        var root = System.Text.Json.Nodes.JsonNode.Parse(ApiFlat)!.AsObject();
        var api = root["api"]!.AsObject();
        foreach (var property in System.Text.Json.Nodes.JsonNode.Parse(apiPatchJson)!.AsObject().ToList())
        {
            api.Remove(property.Key);
            api[property.Key] = property.Value?.DeepClone();
        }
        return root.ToJsonString();
    }

    private static string ApiTreeWith(string apiPatchJson)
    {
        var root = System.Text.Json.Nodes.JsonNode.Parse(ApiTree)!.AsObject();
        var api = root["api"]!.AsObject();
        foreach (var property in System.Text.Json.Nodes.JsonNode.Parse(apiPatchJson)!.AsObject().ToList())
        {
            api.Remove(property.Key);
            api[property.Key] = property.Value?.DeepClone();
        }
        return root.ToJsonString();
    }

    // ---- API ----------------------------------------------------------------------------------
    private static void RegisterApi()
    {
        Add("api-flat+sources", ApiWith("""
            {"urlTemplate":"https://example.test/api/{category}/{week}/{page}/{day}",
             "parameters":[
               {"name":"category","source":{"kind":"discovery","urlTemplate":"https://example.test/api/categories","itemsPath":"categories","valuePath":"slug"}},
               {"name":"week","source":{"kind":"range","type":"IsoWeek","from":"2026-W01","to":"2026-W03"}},
               {"name":"page","source":{"kind":"range","type":"Number","from":"1","to":"3"}},
               {"name":"day","source":{"kind":"range","type":"Date","from":"20260101","to":"20260103","format":"{yyyy}{mm}{dd}"}}]}
            """));
        Add("api-flat+browser-discovery", ApiWith("""
            {"urlTemplate":"https://example.test/api/{category}",
             "parameters":[{"name":"category","source":{"kind":"browserDiscovery","discoveryUrl":"https://example.test/shop","actions":[{"kind":"click","selector":"button.menu"},{"kind":"waitFor","selector":"nav.menu a"}]}}]}
            """));
        Add("api-flat+headers-bootstrap", ApiWith("""
            {"headers":[
               {"name":"Accept","value":"application/json"},
               {"name":"X-Api-Key","environmentVariableName":"API_KEY"},
               {"name":"Authorization","template":"Bearer {token}"}],
             "bootstrap":{"name":"token","method":"POST","url":"https://example.test/auth/token",
               "bodyFields":[{"name":"client_id","value":"abc"},{"name":"client_secret","environmentVariableName":"CLIENT_SECRET"}],
               "bodyEncoding":"Form","valuePath":"access_token"}}
            """));
        Add("api-flat+bootstrap-json", ApiWith("""
            {"headers":[{"name":"Authorization","template":"Bearer {session}"}],
             "bootstrap":{"name":"session","url":"https://example.test/auth/session","valuePath":"data.token"}}
            """));
        Add("api-flat+post-body", ApiWith("""
            {"method":"POST","urlTemplate":"https://example.test/api/search",
             "parameters":[{"name":"week","source":{"kind":"staticList","values":["1","2"]}}],
             "body":{"properties":{
               "query":{"kind":"String","stringValue":"{ items { name price } }"},
               "variables":{"properties":{
                 "week":{"parameterName":"week","coerceTo":"Number"},
                 "limit":{"kind":"Number","numberValue":50},
                 "active":{"kind":"Boolean","boolValue":true},
                 "cursor":{"kind":"Null"},
                 "tags":{"items":[{"kind":"String","stringValue":"a"},{"kind":"String","stringValue":"b"}]}}}}}}
            """));
        Add("api-flat+cursor-pagination-query", ApiWith("""
            {"cursorPagination":{"nextCursorPath":"meta.next","target":"Query","queryParameterName":"cursor","maxPages":10}}
            """));
        Add("api-flat+cursor-pagination-body", ApiWith("""
            {"method":"POST","parameters":[],"urlTemplate":"https://example.test/api/items",
             "body":{"properties":{"cursor":{"kind":"Null"},"size":{"kind":"Number","numberValue":20}}},
             "cursorPagination":{"nextCursorPath":"meta.next","hasNextPagePath":"meta.more","target":"Body","bodyPath":"cursor","maxPages":7}}
            """));
        Add("api-flat+link-header-pagination", ApiWith("""{"linkHeaderPagination":{"maxPages":12}}"""));
        Add("api-flat+embedded-json", ApiWith("""
            {"urlTemplate":"https://example.test/page?week={week}","embeddedJsonSource":{"scriptSelector":"script#__NEXT_DATA__"}}
            """));
        Add("api-flat+transforms", Api("""
            {"api":{"method":"GET","urlTemplate":"https://example.test/api/items","parameters":[],"itemsPath":"items","fields":[
              {"name":"Name","path":"name","transforms":[{"kind":"trim"}]},
              {"name":"Price","path":"price","transforms":[{"kind":"toNumber"},{"kind":"toCurrency","format":"1,234.56"}]},
              {"name":"First","path":"first","hiddenFromOutput":true},
              {"name":"Both","transforms":[{"kind":"combineFields","sourceFieldNames":["First","Name"],"separator":" "}]}]}}
            """));
        Add("api-flat+hardening-all", ApiFlat, HardeningAll.Replace("\"Title\"", "\"Name\""));
        Add("api-flat+change-detection", ApiFlat, ChangeDetectionWebhook);
        Add("api-flat+proxy-retry-delay", ApiFlat, """{"proxy":{"environmentVariableName":"PROXY_LIST"},"retry":{"maxAttempts":3,"retryOnStatusCodes":[429]},"requestDelay":{"minMs":500,"maxMs":1000},"respectRobotsDelay":true,"robotsDisallow":{"action":"Skip"}}""");
        Add("api-flat+dedup-incremental", ApiFlat, """{"deduplication":{"keyFields":["Name"],"incremental":true,"incrementalOutput":"Delta","retention":{"kind":"MaxAge","value":14}}}""");
        Add("api-flat+append-output", ApiFlat, """{"appendOutput":true}""");
        Add("api-flat+external-config", ApiFlat, """{"externalConfig":true}""");
        Add("api-flat+output-blueprint", ApiFlat, """{"outputBlueprint":{"blueprintId":4,"schemaKind":"Flat","fields":[{"targetField":"product","sourceField":"Name"},{"targetField":"price_eur","sourceField":"Price"}]}}""");

        Add("api-tree+sources-and-post", ApiTreeWith("""
            {"method":"POST","urlTemplate":"https://example.test/api/catalog",
             "parameters":[{"name":"week","source":{"kind":"range","type":"Number","from":"1","to":"2"}}],
             "body":{"properties":{"week":{"parameterName":"week","coerceTo":"String"}}}}
            """));
        Add("api-tree+headers-bootstrap", ApiTreeWith("""
            {"headers":[{"name":"Authorization","template":"Bearer {token}"}],
             "bootstrap":{"name":"token","url":"https://example.test/auth","valuePath":"token"}}
            """));
        Add("api-tree+cursor-pagination", ApiTreeWith("""{"cursorPagination":{"nextCursorPath":"next","target":"Query","queryParameterName":"after","maxPages":4}}"""));
        Add("api-tree+link-header-pagination", ApiTreeWith("""{"linkHeaderPagination":{"maxPages":6}}"""));
        Add("api-tree+embedded-json", ApiTreeWith("""{"embeddedJsonSource":{"scriptSelector":"script[type=\"application/json\"]"}}"""));
        Add("api-tree+hardening-all", ApiTree, """
            {"hardening":[
              {"kind":"noResult","severity":"Error"},
              {"kind":"nullRate","severity":"Warning","fieldName":"Price","threshold":0.3},
              {"kind":"baseline","severity":"Warning","dropThreshold":0.5},
              {"kind":"blocking","severity":"Error","minBodyLength":200},
              {"kind":"requiredFields","severity":"Error","fieldNames":["Title","Price"]}]}
            """);
        Add("api-tree+transforms-and-derived-fields", Api("""
            {"api":{"method":"GET","urlTemplate":"https://example.test/api/catalog","parameters":[],"groups":[
              {"name":"Category","path":"categories","children":[
                {"name":"Name","path":"name"},
                {"name":"Product","path":"products","children":[
                  {"name":"Title","path":"title","transforms":[{"kind":"trim"}]},
                  {"name":"Price","path":"price","transforms":[{"kind":"toNumber"}]},
                  {"name":"Raw","path":"raw","hiddenFromOutput":true},
                  {"name":"Label","transforms":[{"kind":"combineFields","sourceFieldNames":["Title","Raw"],"separator":"/"}]}]}]}]}}
            """));
        Add("api-tree+change-detection-append-external-config", ApiTree, ChangeDetectionEmail);
        Add("api-tree+append-external-config", ApiTree, """{"appendOutput":true,"externalConfig":true}""");
        Add("api-tree+proxy-retry-delay", ApiTree, """{"proxy":{"environmentVariableName":"PROXY_LIST"},"retry":{},"requestDelay":{"minMs":200,"maxMs":400},"robotsDisallow":{"action":"Abort"}}""");
    }

    private static string Api(string json) => """{"url":"https://example.test/api","engine":"Static",""" + json.TrimStart().TrimStart('{');

    // ---- Blocks and Combined ------------------------------------------------------------------
    private const string BlocksBase = """
        {"url":"https://example.test/offers",
         "blocks":[
           {"name":"Deals","fields":[{"name":"Title","selector":"div.deal h3"},{"name":"Price","selector":"div.deal .price"}]},
           {"name":"Vouchers","groups":[{"name":"Voucher","selector":"div.voucher","repeating":true,"children":[{"name":"Code","selector":".code","mode":"Text"},{"name":"Link","selector":"a","mode":"Attribute","attribute":"href"}]}]}]}
        """;

    private const string CombinedBase = """
        {"url":"https://example.test",
         "combined":[
           {"name":"products","config":{"url":"https://example.test/products","fields":[{"name":"Title","selector":"h2.title"},{"name":"Price","selector":"span.price"}]}},
           {"name":"api_items","config":{"url":"https://example.test/api","api":{"method":"GET","urlTemplate":"https://example.test/api/items","parameters":[],"itemsPath":"items","fields":[{"name":"Name","path":"name"}]}}}]}
        """;

    private static void RegisterBlocksAndCombined()
    {
        Add("blocks-static", BlocksBase);
        Add("blocks-browser", BlocksBase, """{"engine":"Browser"}""");
        Add("blocks-browser+login-persistent-session", BlocksBase, $$"""{"engine":"Browser","browserActions":{{LoginActions}},"persistentSession":true}""");
        Add("blocks-static+shared-navigation", BlocksBase, """
            {"additionalUrls":["https://example.test/offers?page=2"],"pagination":{"kind":"nextLink","nextLinkSelector":"a.next","maxPages":3},
             "headers":[{"name":"Accept-Language","value":"de"}],"proxy":{"environmentVariableName":"PROXY_LIST"},"retry":{"maxAttempts":2},"requestDelay":{"minMs":300,"maxMs":600}}
            """);
        Add("blocks-static+per-block-formats-and-names", BlocksBase, """
            {"blocks":[
              {"name":"Deals","outputFileName":"deals_out","outputFormat":"Json","fields":[{"name":"Title","selector":"div.deal h3"}]},
              {"name":"Vouchers","outputFileName":"vouchers_out","outputFormat":"Xml","groups":[{"name":"Voucher","selector":"div.voucher","repeating":true,"children":[{"name":"Code","selector":".code","mode":"Text"}]}]},
              {"name":"Tickets","outputFormat":"Csv","fields":[{"name":"Name","selector":".ticket"}]}]}
            """);
        Add("blocks-static+per-block-monitoring", BlocksBase, """
            {"blocks":[
              {"name":"Deals","fields":[{"name":"Title","selector":"div.deal h3"},{"name":"Price","selector":"div.deal .price"}],
               "hardening":[{"kind":"noResult","severity":"Error"},{"kind":"nullRate","severity":"Warning","fieldName":"Price","threshold":0.5},{"kind":"requiredFields","severity":"Warning","fieldNames":["Title"]}],
               "changeDetection":{"notify":"Webhook","webhook":{"urlEnvVar":"WEBHOOK_URL"}}},
              {"name":"Vouchers","groups":[{"name":"Voucher","selector":"div.voucher","repeating":true,"children":[{"name":"Code","selector":".code","mode":"Text"}]}],
               "hardening":[{"kind":"noResult","severity":"Warning"},{"kind":"baseline","severity":"Warning","dropThreshold":0.3},{"kind":"blocking","severity":"Warning","blockPhrases":["Access Denied"]}]}]}
            """);
        Add("blocks-static+transforms-and-text-filter", BlocksBase, """
            {"blocks":[
              {"name":"Deals","fields":[
                {"name":"Price","selector":"div.deal .price","transforms":[{"kind":"toCurrency","format":"1.234,56"}]},
                {"name":"Buy","selector":"a:contains(\"Buy now\")","attribute":"href"}]},
              {"name":"Vouchers","groups":[{"name":"Voucher","selector":"div.voucher","repeating":true,"children":[{"name":"Code","selector":".code","mode":"OwnText"}]}]}]}
            """);
        Add("blocks-static+robots-and-dedup", BlocksBase, """{"robotsDisallow":{"action":"Skip"},"respectRobotsDelay":true,"appendOutput":true}""");

        Add("combined-static+api", CombinedBase);
        Add("combined-static+browser-and-container", CombinedBase, """
            {"combined":[
              {"name":"menu","config":{"url":"https://example.test/menu","engine":"Browser","browserActions":[{"kind":"scroll","maxIterations":4}],"groups":[{"name":"Dish","selector":"li.dish","repeating":true,"children":[{"name":"Name","selector":"h3","mode":"Text"}]}]}},
              {"name":"prices","config":{"url":"https://example.test/prices","fields":[{"name":"Price","selector":"span.price"}]}},
              {"name":"login_area","config":{"url":"https://example.test/account","engine":"Browser","persistentSession":true,"browserActions":[{"kind":"fill","selector":"#user","environmentVariableName":"SITE_USERNAME"},{"kind":"click","selector":"button.login"},{"kind":"waitFor","selector":".account"}],"fields":[{"name":"Balance","selector":".balance"}]}}]}
            """);
        Add("combined-static+component-features", CombinedBase, """
            {"combined":[
              {"name":"products","config":{"url":"https://example.test/products","fields":[{"name":"Title","selector":"h2.title"},{"name":"Price","selector":"span.price","transforms":[{"kind":"toNumber"}]}],
                "pagination":{"kind":"pageNumber","urlTemplate":"{url}?page={page}","maxPages":3},"hardening":[{"kind":"noResult","severity":"Warning"}],"proxy":{"environmentVariableName":"PROXY_LIST"},"retry":{"maxAttempts":2},"deduplication":{"keyFields":["Title"]}}},
              {"name":"reviews","config":{"url":"https://example.test/reviews","additionalUrls":["https://example.test/reviews?page=2"],"fields":[{"name":"Author","selector":".author"}],
                "changeDetection":{"notify":"Webhook","webhook":{"urlEnvVar":"WEBHOOK_URL"}},"requestDelay":{"minMs":500,"maxMs":900}}}]}
            """);
        Add("combined-static+file-names", CombinedBase, """{"scriptFileName":"everything","outputFileName":"all_data"}""");
        Add("combined-static+unnamed-components", CombinedBase, """
            {"combined":[
              {"config":{"url":"https://example.test/a","fields":[{"name":"A","selector":".a"}]}},
              {"config":{"url":"https://example.test/b","fields":[{"name":"B","selector":".b"}]}}]}
            """);
    }

    // ---- Interactions: features that touch the same template regions --------------------------
    private static void RegisterInteractions()
    {
        var b = WithBrowser(Flat);
        Add("static-flat+everything-monitored", Flat, """
            {"additionalUrls":["https://example.test/list?page=2"],
             "pagination":{"kind":"nextLink","nextLinkSelector":"a.next","maxPages":3},
             "hardening":[{"kind":"noResult","severity":"Error"},{"kind":"nullRate","severity":"Warning","fieldName":"Price","threshold":0.5},{"kind":"baseline","severity":"Error","dropThreshold":0.2},{"kind":"blocking","severity":"Warning","minBodyLength":500},{"kind":"requiredFields","severity":"Warning","fieldNames":["Title"]}],
             "changeDetection":{"notify":"Webhook","webhook":{"urlEnvVar":"WEBHOOK_URL"}},
             "deduplication":{"keyFields":["Title"],"incremental":true,"incrementalOutput":"Append"},
             "appendOutput":true,"externalConfig":true,"proxy":{"environmentVariableName":"PROXY_LIST"},
             "retry":{"maxAttempts":3},"requestDelay":{"minMs":500,"maxMs":1500},"respectRobotsDelay":true,"robotsDisallow":{"action":"Skip"},"preflight":true,
             "headers":[{"name":"Referer","value":"https://example.test/"}]}
            """);
        Add("browser-flat+everything-monitored", b, $$"""
            {"additionalUrls":["https://example.test/list?page=2"],
             "browserActions":{{LoginActions}},"persistentSession":true,
             "pagination":{"kind":"pageNumber","urlTemplate":"{url}?page={page}","maxPages":3},
             "hardening":[{"kind":"noResult","severity":"Error"},{"kind":"nullRate","severity":"Warning","fieldName":"Price","threshold":0.5},{"kind":"baseline","severity":"Error","dropThreshold":0.2},{"kind":"blocking","severity":"Warning","minBodyLength":500},{"kind":"requiredFields","severity":"Warning","fieldNames":["Title"]}],
             "changeDetection":{"notify":"Email","email":{"smtpHostEnvVar":"SMTP_HOST","fromEnvVar":"MAIL_FROM","toEnvVar":"MAIL_TO"} },
             "deduplication":{"keyFields":["Title"],"incremental":true,"incrementalOutput":"Delta"},
             "appendOutput":true,"externalConfig":true,"proxy":{"environmentVariableName":"PROXY_LIST"},
             "retry":{"maxAttempts":3},"requestDelay":{"minMs":500,"maxMs":1500},"respectRobotsDelay":true,"robotsDisallow":{"action":"Abort"},"preflight":true}
            """);
        Add("static-container+everything-monitored", Container, """
            {"additionalUrls":["https://example.test/menu/lunch"],
             "pagination":{"kind":"nextLink","nextLinkSelector":"a.next","maxPages":3},
             "hardening":[{"kind":"noResult","severity":"Error"},{"kind":"nullRate","severity":"Warning","fieldName":"Price","threshold":0.5},{"kind":"baseline","severity":"Error","dropThreshold":0.2},{"kind":"blocking","severity":"Warning"},{"kind":"requiredFields","severity":"Error","fieldNames":["Name"]}],
             "changeDetection":{"notify":"Webhook","webhook":{"urlEnvVar":"WEBHOOK_URL"}},
             "deduplication":{"keyFields":["Name"]},"appendOutput":true,"externalConfig":true,
             "outputFormat":"Json","proxy":{"environmentVariableName":"PROXY_LIST"},"retry":{},"requestDelay":{"minMs":100,"maxMs":200}}
            """);
        Add("static-flat+sqlite-dedup-hardening", Flat, """{"outputFormat":"Sqlite","deduplication":{"keyFields":["Title"],"incremental":true,"incrementalOutput":"Append"},"hardening":[{"kind":"noResult","severity":"Error"},{"kind":"requiredFields","severity":"Warning","fieldNames":["Title"]}],"appendOutput":true}""");
        Add("static-flat+xlsx-blueprint-transforms", Flat, """
            {"outputFormat":"Xlsx","fields":[{"name":"Title","selector":"h2.title"},{"name":"Price","selector":"span.price","transforms":[{"kind":"toNumber"}]}],
             "outputBlueprint":{"blueprintId":5,"schemaKind":"Flat","fields":[{"targetField":"name","sourceField":"Title"},{"targetField":"amount","sourceField":"Price"}]},"appendOutput":true}
            """);
        Add("static-flat+json-append-dedup", Flat, """{"outputFormat":"Json","appendOutput":true,"deduplication":{"keyFields":["Title"],"incremental":true,"incrementalOutput":"Delta"}}""");
        Add("static-flat+external-config-renamed-fields-urls", Flat, """{"externalConfig":true,"additionalUrls":["https://example.test/list?page=2"],"outputFileName":"renamed","fields":[{"name":"Title","selector":"h2.title"},{"name":"Price","selector":"span.price"}]}""");
        Add("static-container+sqlite-hardening", Container, """{"outputFormat":"Sqlite","hardening":[{"kind":"noResult","severity":"Warning"}]}""");
        Add("api-flat+sqlite-dedup-hardening", ApiFlat, """{"outputFormat":"Sqlite","deduplication":{"keyFields":["Name"],"incremental":true},"hardening":[{"kind":"noResult","severity":"Error"}]}""");
        Add("api-flat+xlsx", ApiFlat, """{"outputFormat":"Xlsx","appendOutput":true}""");
    }
}
