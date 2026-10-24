using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Tests;

// The two plans every download end-to-end test is built on: one flat "FileLink" field (href of a.file) or one container field
// "Photo" (src of .photo inside a repeating .item), on the static or the Browser engine.
internal static class DownloadPlans
{
    public static ScrapingPlan Flat(
        string startUrl, bool download, int? maxDownloadSizeBytes = null, List<string>? allowedContentTypes = null,
        ScrapingEngine engine = ScrapingEngine.Static) => new()
    {
        Engine = engine,
        Steps =
        [
            new NavigateStep { Urls = [startUrl] },
            new ExtractStep
            {
                Name = "FileLink", Selector = "a.file", Attribute = "href", Download = download,
                MaxDownloadSizeBytes = maxDownloadSizeBytes, AllowedContentTypes = allowedContentTypes,
            },
        ],
    };

    public static ScrapingPlan Container(
        string startUrl, bool download, int? maxDownloadSizeBytes = null, List<string>? allowedContentTypes = null,
        ScrapingEngine engine = ScrapingEngine.Static) => new()
    {
        Engine = engine,
        Steps =
        [
            new NavigateStep { Urls = [startUrl] },
            new ExtractGroupStep
            {
                Roots =
                [
                    new GroupNode
                    {
                        Name = "Item", Selector = ".item", Repeating = true,
                        Children =
                        [
                            new DataFieldNode
                            {
                                Name = "Photo", Selector = ".photo", Mode = ExtractMode.Attribute, Attribute = "src", Download = download,
                                MaxDownloadSizeBytes = maxDownloadSizeBytes, AllowedContentTypes = allowedContentTypes,
                            },
                        ],
                    },
                ],
            },
        ],
    };
}
