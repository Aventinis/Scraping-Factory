using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #400: the extension's transform editor generates regex patterns from
// "recipes" (text after …, text between … and …, text inside brackets, first
// number, …), escaping the user's own text. The extension checks them against
// Python's `re` in Jest; this proves the same shapes pass the companion's .NET
// `Regex` validation (ScrapingPlanValidator) AND produce the expected value when
// the real generated script runs — the "stay in the common subset" requirement.
// The patterns below are what transform-helpers.js generates for the named
// recipes, including ones whose user text contains regex metacharacters.
public class RegexRecipeEndToEndTests
{
    public static IEnumerable<object[]> Cases() =>
    [
        // pattern, group, raw value on the page, expected cell
        [@"-?\d+(?:[.,]\d+)*", 0, "Preis 12.99 EUR", "12.99"],
        [@"\d+", 0, "Art.-Nr. 4711-B", "4711"],
        [@"Preis:\s*(.+)", 1, "Preis: 12.99 EUR", "12.99 EUR"],
        [@"Art\.-Nr\.\s*(.+)", 1, "Art.-Nr. 4711", "4711"],
        [@"a\+b\s*(.+)", 1, "a+b = 3", "= 3"],
        [@"a\|b\s*(.+)", 1, "a|b -> 1", "-> 1"],
        [@"\(inkl\.\)\s*(.+)", 1, "Preis (inkl.) 5", "5"],
        [@"\[x\]\s*(.+)", 1, "[x] erledigt", "erledigt"],
        [@"(.+?)\s*€", 1, "12.99 € netto", "12.99"],
        [@"(.+?)\s*\(", 1, "Müller (Berlin)", "Müller"],
        [@"(.+?)\s*\.", 1, "v1.2.3", "v1"],
        [@"von\s*(.+?)\s*bis", 1, "von 8 bis 17", "8"],
        [@"a\.b\s*(.+?)\s*c\|d", 1, "x a.b mitte c|d y", "mitte"],
        [@"\(([^)]*)\)", 1, "Preis (inkl. MwSt.)", "inkl. MwSt."],
        [@"\[([^\]]*)\]", 1, "Tag [gelb] rot", "gelb"],
        [@"\{([^}]*)\}", 1, "Wert {n} da", "n"],
    ];

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task RecipePattern_IsValidForDotNet_AndGivesTheExpectedValueInPython(string pattern, int group, string raw, string expected)
    {
        var transform = new RegexExtractTransform { Pattern = pattern, Group = group };

        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com/"] },
                new ExtractStep { Name = "Wert", Selector = ".value", Transforms = [transform] },
            ],
        };
        var validation = ScrapingPlanValidator.Validate(plan);
        Assert.True(validation.Success, validation.Error);

        var cell = await TypeConversionTransformEndToEndTests.ScrapeSingleValueAsync(raw, transform);
        Assert.Equal(expected, cell);
    }
}
