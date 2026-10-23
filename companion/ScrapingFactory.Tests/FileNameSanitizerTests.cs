using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

public class FileNameSanitizerTests
{
    private const string VectorFile = "file-name-sanitizer.json";

    // Issue #388: the extension's sanitizeFileNameBase (scraping-config-builder.ts) runs the same table, so both
    // sides must reach the same name for the same raw input — the companion never reports back which one it used.
    public static IEnumerable<object[]> Cases() => TestVectors.Names(VectorFile);

    [Theory]
    [MemberData(nameof(Cases))]
    public void SanitizeBaseName_MatchesTheSharedVectors(string name)
    {
        var testCase = TestVectors.Case(VectorFile, name);
        Assert.Equal(testCase.StringOrNull("expected"), FileNameSanitizer.SanitizeBaseName(testCase.StringOrNull("input"), testCase.StringOrNull("fallback")!));
    }
}
