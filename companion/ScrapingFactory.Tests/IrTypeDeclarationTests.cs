using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Issue #388: extension/types/wire.ts (the SFWire types the extension's JSDoc and TypeScript code refer to) is a
// hand-kept description of this assembly's wire types. Generating it was evaluated and rejected (see
// docs/ARCHITECTURE.md, "Wire-format mirrors"): this test is the guard instead. It parses the declaration file and
// compares it with the real IR types by reflection:
//   * every interface must have an IR class of the same name with exactly the same JSON properties (the polymorphic
//     `kind` discriminator is the one allowed extra), and a `required` C# property must not be optional in wire.ts;
//   * every string-literal union that names an IR enum must list exactly the enum's members.
// Anything knowingly different goes into the allow-lists below with its reason.
public class IrTypeDeclarationTests
{
    private static readonly string DeclarationFile = Path.Combine(TestVectors.RepoRoot, "extension", "types", "wire.ts");

    // interface name -> reason; the interface is not an IR class (or intentionally differs).
    private static readonly Dictionary<string, string> InterfaceNotCompared = new()
    {
    };

    // "Interface.property" -> reason: a deliberate difference between wire.ts and the IR class.
    private static readonly Dictionary<string, string> PropertyDifferences = new()
    {
    };

    private sealed record Member(string Name, bool Optional);

    private static string StripComments(string text)
    {
        text = Regex.Replace(text, @"/\*.*?\*/", "", RegexOptions.Singleline);
        return Regex.Replace(text, @"//[^\n]*", "");
    }

    // Splits an interface body at top-level ';' (depth counted over {}[]()<> and string literals).
    private static List<string> TopLevelMembers(string body)
    {
        var members = new List<string>();
        var depth = 0;
        var current = new StringBuilder();
        char? quote = null;
        for (var i = 0; i < body.Length; i++)
        {
            var c = body[i];
            if (quote is not null)
            {
                current.Append(c);
                if (c == quote) quote = null;
                continue;
            }
            switch (c)
            {
                case '\'' or '"': quote = c; current.Append(c); break;
                case '{' or '[' or '(' or '<': depth++; current.Append(c); break;
                case '}' or ']' or ')': depth--; current.Append(c); break;
                case '>' when i > 0 && body[i - 1] == '=': current.Append(c); break; // the arrow of a function type
                case '>': depth--; current.Append(c); break;
                case ';' when depth == 0: members.Add(current.ToString().Trim()); current.Clear(); break;
                default: current.Append(c); break;
            }
        }
        if (current.ToString().Trim().Length > 0) members.Add(current.ToString().Trim());
        return members.Where(m => m.Length > 0).ToList();
    }

    private static Dictionary<string, List<Member>> ParseInterfaces()
    {
        var text = StripComments(File.ReadAllText(DeclarationFile));
        var result = new Dictionary<string, List<Member>>();
        foreach (Match header in Regex.Matches(text, @"\binterface\s+(\w+)\s*\{"))
        {
            var start = header.Index + header.Length;
            var depth = 1;
            var end = start;
            for (; end < text.Length && depth > 0; end++)
            {
                if (text[end] == '{') depth++;
                else if (text[end] == '}') depth--;
            }
            var body = text[start..(end - 1)];
            var members = new List<Member>();
            foreach (var member in TopLevelMembers(body))
            {
                var m = Regex.Match(member, @"^(?:readonly\s+)?(\w+)(\?)?\s*:");
                if (m.Success) members.Add(new Member(m.Groups[1].Value, m.Groups[2].Success));
            }
            result[header.Groups[1].Value] = members;
        }
        return result;
    }

    private static Dictionary<string, List<string>> ParseLiteralUnions()
    {
        var text = StripComments(File.ReadAllText(DeclarationFile));
        var result = new Dictionary<string, List<string>>();
        foreach (Match m in Regex.Matches(text, @"\btype\s+(\w+)\s*=\s*((?:\s*\|?\s*'[^']*')+)\s*;"))
            result[m.Groups[1].Value] = Regex.Matches(m.Groups[2].Value, @"'([^']*)'").Select(x => x.Groups[1].Value).ToList();
        return result;
    }

    private static readonly Assembly IrAssembly = typeof(ScrapingConfig).Assembly;

    private static Type? IrType(string name) => IrAssembly.GetTypes().FirstOrDefault(t => t.Namespace == typeof(ScrapingConfig).Namespace && t.Name == name);

    private static string JsonName(PropertyInfo property) =>
        property.GetCustomAttribute<JsonPropertyNameAttribute>()?.Name ?? JsonNamingPolicy.CamelCase.ConvertName(property.Name);

    private static IEnumerable<PropertyInfo> WireProperties(Type type) =>
        type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(p => p.GetCustomAttribute<JsonIgnoreAttribute>() is null && p.SetMethod is { IsPublic: true });

    public static IEnumerable<object[]> InterfaceNames() => ParseInterfaces().Keys.Order().Select(n => new object[] { n });
    public static IEnumerable<object[]> UnionNames() =>
        ParseLiteralUnions().Keys.Where(n => IrType(n) is { IsEnum: true }).Order().Select(n => new object[] { n });

    [Fact]
    public void TheParserFindsTheDeclarations()
    {
        var interfaces = ParseInterfaces();
        Assert.True(interfaces.Count > 40, $"only {interfaces.Count} interfaces parsed — has the file format changed?");
        Assert.True(interfaces["ScrapingConfig"].Count > 25);
    }

    [Theory]
    [MemberData(nameof(InterfaceNames))]
    public void Interface_HasTheSamePropertiesAsTheIrClass(string name)
    {
        if (InterfaceNotCompared.ContainsKey(name)) return;
        var type = IrType(name);
        Assert.True(type is not null, $"wire.ts declares interface {name}, but the IR has no type of that name (rename it, or add it to InterfaceNotCompared with a reason).");

        var declared = ParseInterfaces()[name];
        var actual = WireProperties(type!).ToDictionary(JsonName, p => p);
        // `kind` is the polymorphic discriminator unless the class has a real Kind property of its own (ApiBodyLiteral).
        var declaredNames = declared.Select(m => m.Name).Where(n => n != "kind" || actual.ContainsKey("kind")).ToHashSet();

        var missingInDts = actual.Keys.Where(k => !declaredNames.Contains(k) && !PropertyDifferences.ContainsKey($"{name}.{k}")).Order().ToList();
        var extraInDts = declaredNames.Where(k => !actual.ContainsKey(k) && !PropertyDifferences.ContainsKey($"{name}.{k}")).Order().ToList();
        Assert.True(missingInDts.Count == 0 && extraInDts.Count == 0,
            $"wire.ts and the IR disagree on {name}:" +
            (missingInDts.Count > 0 ? $"{Environment.NewLine}  in the IR but not in wire.ts: {string.Join(", ", missingInDts)}" : "") +
            (extraInDts.Count > 0 ? $"{Environment.NewLine}  in wire.ts but not in the IR: {string.Join(", ", extraInDts)}" : ""));

        var optionalButRequired = declared
            .Where(m => m.Optional && actual.TryGetValue(m.Name, out var p) && p.GetCustomAttribute<System.Runtime.CompilerServices.RequiredMemberAttribute>() is not null)
            .Select(m => m.Name).Where(n => !PropertyDifferences.ContainsKey($"{name}.{n}")).ToList();
        Assert.True(optionalButRequired.Count == 0, $"{name}: required in the IR but optional in wire.ts: {string.Join(", ", optionalButRequired)}");
    }

    [Theory]
    [MemberData(nameof(UnionNames))]
    public void StringUnion_ListsExactlyTheMembersOfTheIrEnum(string name)
    {
        var declared = ParseLiteralUnions()[name].Order().ToList();
        var actual = Enum.GetNames(IrType(name)!).Order().ToList();
        Assert.True(declared.SequenceEqual(actual),
            $"wire.ts type {name} = {string.Join(" | ", declared)} but the enum has {string.Join(", ", actual)}.");
    }

    [Fact]
    public void AllowListEntriesStillMatchSomething()
    {
        var interfaces = ParseInterfaces();
        var stale = InterfaceNotCompared.Keys.Where(k => !interfaces.ContainsKey(k))
            .Concat(PropertyDifferences.Keys.Where(k => !interfaces.ContainsKey(k.Split('.')[0]))).ToList();
        Assert.True(stale.Count == 0, "Allow-list entries without a matching interface: " + string.Join(", ", stale));
    }
}
