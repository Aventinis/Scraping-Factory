namespace ScrapingFactory.Compiler.IR;

// Container-Mode's tree shape, parallel to the flat ScrapingField: a
// GroupNode scopes its children to matches of its own selector (either
// exactly one, or N repeated instances), DataFieldNode is the leaf that
// actually extracts a value from within that scope. See ExtractGroupStep.
public abstract class ContainerNode
{
    public required string Name { get; init; }
}

public sealed class GroupNode : ContainerNode
{
    // Relative to the parent scope (document for a root node, the matched
    // element for a nested one) — same relative-selector convention the
    // codegen's extract_group() walks at runtime.
    public required string Selector { get; init; }

    // false = exactly one match expected ("Einzelnes Element"), true = the
    // selector may match N times, one <Name> element per match
    // ("Wiederholend"). Chosen explicitly by the user, never inferred from
    // match count.
    public required bool Repeating { get; init; }

    public required List<ContainerNode> Children { get; init; }

    // Browser-engine only (Issue #42, Phase 3): see ExtractStep.FramePath —
    // same meaning, resolved as an *absolute* path from the top document
    // regardless of this node's own nesting depth in the tree, independent
    // of any ancestor's FramePath (there's no path composition/inheritance
    // — every node's FramePath, when set, is a complete top-to-target
    // chain). null (the default) means Selector is evaluated against the
    // inherited scope exactly as before this field existed.
    public List<string>? FramePath { get; init; }
}

public sealed class DataFieldNode : ContainerNode
{
    public required string Selector { get; init; }
    public ExtractMode Mode { get; init; } = ExtractMode.Text;

    // Only meaningful (and required) when Mode == Attribute.
    public string? Attribute { get; init; }

    // See GroupNode.FramePath — same meaning and same "absolute, not
    // inherited" semantics.
    public List<string>? FramePath { get; init; }

    // See ExtractStep.Transforms (Issue #84) — same meaning. Not applied
    // when Mode == Exists (a boolean-ish presence check, not a string
    // pipeline); the extension UI hides the transform section for that mode.
    public List<FieldTransform>? Transforms { get; init; }

    // Issue #213: only meaningful (and only valid, see
    // ScrapingPlanValidator) when Mode == Attribute — the attribute's raw
    // extracted value is treated as a URL to an embedded resource (e.g. an
    // <img>'s src), downloaded by the generated script and replaced with
    // the resource's own local file path instead of the bare URL. A plain
    // non-nullable bool defaulting to false, like GroupNode.Repeating and
    // Mode itself, since this is a per-field toggle rather than a plan-level
    // opt-in (contrast ScrapingConfig's own nullable bool? flags, where
    // null/false both mean "today's exact behavior" at the wire level).
    // Container mode only for this first version — flat mode has no
    // attribute-picking UI at all yet (ScrapingField.Attribute is wire-only,
    // never set by any extension flow) and API mode has no Mode/Attribute
    // concept, so extending Download to either would need that UI built
    // first; left for a follow-up issue, the same "ship the simpler shape
    // first" precedent OutputBlueprintTreeSchema/RequiredFieldsCheck etc.
    // already established elsewhere in this codebase.
    public bool Download { get; init; }
}

// Issue #169: OwnText extracts only the direct text-node children of the
// matched element, excluding text contributed by any nested element — e.g.
// <h3>Burrata mit Tomaten<span class="badge">vegan möglich</span></h3>
// yields "Burrata mit Tomaten", not the two concatenated (which is what
// Text mode's plain get_text()/text_content() would produce, since that
// walks every descendant). See scraper_grouped.py.j2/
// playwright_scraper_grouped.py.j2's own extract_group() for the runtime
// implementation difference between the two.
public enum ExtractMode { Text, Attribute, Exists, OwnText }
