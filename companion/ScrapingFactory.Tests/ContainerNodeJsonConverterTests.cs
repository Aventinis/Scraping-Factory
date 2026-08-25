using System.Text.Json;
using System.Text.Json.Serialization;
using ScrapingFactory.Compiler.IR;
using Xunit;

namespace ScrapingFactory.Tests;

// Exercises ContainerNodeJsonConverter directly: without it, System.Text.Json
// can neither deserialize into the abstract ContainerNode (GroupNode.Children)
// nor serialize a List<ContainerNode> without silently dropping
// derived-only properties.
public class ContainerNodeJsonConverterTests
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(), new ContainerNodeJsonConverter() },
    };

    [Fact]
    public void Deserialize_NestedGroupsAndFields_ProducesExpectedTree()
    {
        const string json = """
            {
              "url": "https://example.com",
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
                      "children": [
                        { "name": "Name", "selector": "h3" },
                        { "name": "Link", "selector": "a", "mode": "Attribute", "attribute": "href" },
                        { "name": "Vegan", "selector": ".vegan", "mode": "Exists" }
                      ]
                    }
                  ]
                }
              ]
            }
            """;

        var config = JsonSerializer.Deserialize<ScrapingConfig>(json, Options);

        var root = Assert.Single(config!.Groups!);
        Assert.Equal("Kategorie", root.Name);
        Assert.True(root.Repeating);
        Assert.Equal(2, root.Children.Count);

        var titel = Assert.IsType<DataFieldNode>(root.Children[0]);
        Assert.Equal("Titel", titel.Name);
        Assert.Equal(ExtractMode.Text, titel.Mode);

        var gericht = Assert.IsType<GroupNode>(root.Children[1]);
        Assert.Equal(3, gericht.Children.Count);

        var link = Assert.IsType<DataFieldNode>(gericht.Children[1]);
        Assert.Equal(ExtractMode.Attribute, link.Mode);
        Assert.Equal("href", link.Attribute);

        var vegan = Assert.IsType<DataFieldNode>(gericht.Children[2]);
        Assert.Equal(ExtractMode.Exists, vegan.Mode);
    }

    [Fact]
    public void SerializeThenDeserialize_RoundTripsGroupAndFieldProperties()
    {
        var config = new ScrapingConfig
        {
            Url = "https://example.com",
            Groups =
            [
                new GroupNode
                {
                    Name = "Kategorie",
                    Selector = "section",
                    Repeating = false,
                    Children =
                    [
                        new DataFieldNode { Name = "Link", Selector = "a", Mode = ExtractMode.Attribute, Attribute = "href" },
                    ],
                },
            ],
        };

        var json = JsonSerializer.Serialize(config, Options);
        var roundTripped = JsonSerializer.Deserialize<ScrapingConfig>(json, Options);

        var root = Assert.Single(roundTripped!.Groups!);
        Assert.Equal("Kategorie", root.Name);
        Assert.False(root.Repeating);
        var field = Assert.IsType<DataFieldNode>(Assert.Single(root.Children));
        Assert.Equal("href", field.Attribute);
        Assert.Equal(ExtractMode.Attribute, field.Mode);
    }
}
