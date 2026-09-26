// Issue #191: pure, DOM-free helpers for Output Blueprints — both editing a
// blueprint's own ordered target-field-name list (create/edit modal) and
// building/validating the per-scrape source-field mapping draft (once a
// blueprint is picked on the idle screen). Split the same way
// combined-config.js/field-transforms.js are: no fetch, no DOM, just data.
//
// Issue #244: a second, tree-shaped target schema alongside the original
// flat field-name list — both the blueprint's own target-schema editing
// (create/edit modal) and the per-scrape tree mapping draft below. The
// schema's own tree STRUCTURE (add/remove/rename/reorder/nest a group or
// field node) reuses container-tree.js's generic path-based helpers
// directly (insertContainerNode/removeGroupTreeNode/updateGroupTreeNode/
// moveGroupTreeNode/resolveGroupNode) rather than reimplementing them —
// none of those functions read anything group/field-specific (selector,
// repeating, mode), only `.children`/array shape, so they work unchanged
// against a blueprint schema node's much smaller {kind, name, children}
// shape too, per Architecture Decision #12's "or an existing one it clearly
// extends" rule.
const SFOutputBlueprints = (function () {
  // ── Editing a blueprint's own field-name list (create/edit modal, Flat) ─

  function addBlueprintFieldName(fieldNames) {
    return [...fieldNames, ''];
  }

  function removeBlueprintFieldName(fieldNames, index) {
    return fieldNames.filter((_, i) => i !== index);
  }

  function updateBlueprintFieldName(fieldNames, index, name) {
    return fieldNames.map((n, i) => (i === index ? name : n));
  }

  // direction: -1 (up) or +1 (down) — same swap-with-adjacent-sibling
  // convention as field-transforms.js's moveTransform/combined-config.js's
  // moveComponent.
  function moveBlueprintFieldName(fieldNames, index, direction) {
    const target = index + direction;
    if (target < 0 || target >= fieldNames.length) return fieldNames;
    const copy = [...fieldNames];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    return copy;
  }

  // Blocks saving the same way an empty regexExtract pattern blocks adding a
  // transform — a blank or duplicate target field name can never be a valid
  // 1:1 mapping target, so failing fast here avoids a round trip to the
  // companion just to learn the same thing.
  function blueprintDraftIsValid(name, fieldNames) {
    const trimmedName = name.trim();
    if (!trimmedName || fieldNames.length === 0) return false;
    const trimmed = fieldNames.map(n => n.trim());
    if (trimmed.some(n => !n)) return false;
    return new Set(trimmed).size === trimmed.length;
  }

  // Recursively looks for the "record" shape a sample's field names should
  // actually come from, instead of only ever reading the JSON root's own
  // top-level keys — a real-world JSON sample (e.g. an embedded state blob,
  // the exact kind of nested payload API mode's own EmbeddedJsonSource
  // feature already extracts field names from structurally) is very
  // commonly wrapped in one or more outer keys, e.g.
  // `{"offerTiles": [{"title": "", ...}]}`, where the wrapper key
  // ("offerTiles") is not itself a useful field name. A plain object whose
  // own values are all scalars is treated as the record itself (the
  // original, still-supported "single object sample" case); otherwise this
  // walks into the first array-of-objects or nested object it finds,
  // depth-first, and uses THAT as the record. Ambiguous/mixed shapes (e.g.
  // one scalar property alongside one nested one) prefer the nested match
  // over the outer scalar — a documented heuristic limitation, not a
  // guarantee of the "correct" shape for every possible sample, same as
  // `_to_number`'s own decimal-separator heuristic on the companion side.
  function findSampleRecord(value, depth) {
    if (depth > 10 || value === null || typeof value !== 'object') return null;
    if (Array.isArray(value)) {
      const first = value[0];
      if (!first || typeof first !== 'object') return null;
      return Array.isArray(first) ? findSampleRecord(first, depth + 1) : first;
    }
    const values = Object.values(value);
    const isFlatRecord = Object.keys(value).length > 0 && values.every(v => v === null || typeof v !== 'object');
    if (isFlatRecord) return value;
    for (const v of values) {
      const found = findSampleRecord(v, depth + 1);
      if (found) return found;
    }
    return null;
  }

  // A line consisting only of JSON structural punctuation (`{`, `}`, `[`,
  // `]`, `,`) — never a field name, whether the sample is valid JSON or a
  // hand-edited/truncated fragment of one (e.g. the outer `{`/`}` left
  // behind after deleting a wrapper key's own value).
  function isStructuralOnlyLine(line) {
    return /^[{}[\],]*$/.test(line);
  }

  // Extracts just the key from a JSON/JS-object-literal-style property line
  // (`"key": value` or `key: value`, optionally with a trailing comma) —
  // used by the line-based fallback below to recover a clean field-name
  // list from a pasted object literal that fails strict `JSON.parse` (a
  // trailing comma, or the outer braces trimmed away by hand) but still has
  // one property per line. Returns null when the line doesn't look like a
  // property at all.
  function extractLeadingKey(line) {
    const quoted = line.match(/^"([^"]*)"\s*:/);
    if (quoted) return quoted[1];
    const bare = line.match(/^([A-Za-z_$][\w$-]*)\s*:/);
    return bare ? bare[1] : null;
  }

  // Issue #193: parses an arbitrary pasted/uploaded sample — a JSON object/
  // array, a CSV header row, or a plain newline/comma-separated list of
  // names — into an ordered, deduplicated field-name list: the same shape
  // blueprintEditDraft.fieldNames already expects, so a successful parse can
  // replace it directly (see importBlueprintFieldNamesFromSample in
  // output-blueprints-ui.js). Format is auto-detected from the content
  // itself rather than a separate format picker, per the issue's own
  // "simplest first version" direction: JSON is tried first (see
  // findSampleRecord's own doc comment for how a nested/wrapped sample is
  // handled; an array of strings is used as the field-name list directly),
  // then — if that fails outright — a per-line pass first tries to recognize
  // a pasted-but-not-strictly-valid JSON object literal (see
  // extractLeadingKey), and only once that finds nothing either does a comma
  // in the first remaining line decide CSV-header-row vs. one-name-per-line
  // — the same operation either way (split the first line on commas), which
  // is why a lone comma-separated line (no header semantics at all) is
  // handled identically to a real CSV header. Returns [] when nothing
  // name-like could be found at all (blank input, an empty JSON array/
  // object, a JSON array of non-string primitives) — the caller treats an
  // empty result as "couldn't parse this", not a crash.
  function parseFieldNamesFromSample(text) {
    const dedupeTrimmed = (names) => {
      const seen = new Set();
      const result = [];
      for (const raw of names) {
        const name = String(raw).trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        result.push(name);
      }
      return result;
    };

    const trimmedInput = (text || '').trim();
    if (!trimmedInput) return [];

    try {
      const parsed = JSON.parse(trimmedInput);
      if (Array.isArray(parsed) && parsed.every(v => typeof v === 'string')) {
        return dedupeTrimmed(parsed);
      }
      const sample = findSampleRecord(parsed, 0);
      return sample ? dedupeTrimmed(Object.keys(sample)) : [];
    } catch {
      // Not valid JSON — fall through to the line-based parsing below.
    }

    const lines = trimmedInput.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const meaningfulLines = lines.filter(line => !isStructuralOnlyLine(line));
    if (meaningfulLines.length === 0) return [];

    if (meaningfulLines.some(line => extractLeadingKey(line))) {
      return dedupeTrimmed(meaningfulLines.map(line => extractLeadingKey(line) || line));
    }

    const stripQuotes = s => s.replace(/^"(.*)"$/, '$1');
    if (meaningfulLines[0].includes(',')) {
      return dedupeTrimmed(meaningfulLines[0].split(',').map(stripQuotes));
    }
    return dedupeTrimmed(meaningfulLines);
  }

  // ── Editing a blueprint's own target tree (create/edit modal, Tree) ─────
  // Node shape: { kind: 'group', name, children } | { kind: 'field', name }
  // — deliberately no selector/mode/repeating (see this file's own doc
  // comment on why container-tree.js's structural helpers apply unchanged).

  function buildBlueprintSchemaGroup(name) {
    return { kind: 'group', name, children: [] };
  }

  function buildBlueprintSchemaField(name) {
    return { kind: 'field', name };
  }

  // Converts a fetched blueprint's wire-format tree (OutputBlueprintTreeSchemaNode:
  // {name, children} for a group, {name} for a leaf — no `kind` tag, same
  // structural-only shape ContainerNodeJsonConverter's own wire format uses)
  // into the internal {kind, ...} shape the editor's tree helpers expect.
  function parseBlueprintSchemaTree(wireNodes) {
    return (wireNodes || []).map(node => (Array.isArray(node.children)
      ? { kind: 'group', name: node.name, children: parseBlueprintSchemaTree(node.children) }
      : { kind: 'field', name: node.name }));
  }

  // Reverse of parseBlueprintSchemaTree — strips the popup's internal `kind`
  // tag, mirrors container-tree.js's own serializeGroupTree in spirit.
  function serializeBlueprintSchemaTree(nodes) {
    return nodes.map(node => (node.kind === 'group'
      ? { name: node.name, children: serializeBlueprintSchemaTree(node.children) }
      : { name: node.name }));
  }

  // Every node needs a non-blank name, and a group needs at least one child
  // (an empty group carries no field to ever map anything onto) — mirrors
  // OutputBlueprintTreeSchemaValidator's own companion-side structural check.
  function blueprintTreeSchemaIsValid(name, tree) {
    if (!name.trim() || !tree || tree.length === 0) return false;
    const walk = nodes => nodes.every(node => {
      if (!node.name || !node.name.trim()) return false;
      return node.kind === 'group' ? node.children.length > 0 && walk(node.children) : true;
    });
    return walk(tree);
  }

  // ── Per-scrape source-field mapping draft (Flat) ────────────────────────

  // One entry per target field, source starting unset — targetFieldNames is
  // the picked blueprint's own ordered field list (see fetchOutputBlueprint
  // in output-blueprints-ui.js).
  function createMappingDraft(targetFieldNames) {
    const draft = {};
    for (const name of targetFieldNames) draft[name] = null;
    return draft;
  }

  function updateMappingSource(draft, targetField, sourceField) {
    return { ...draft, [targetField]: sourceField || null };
  }

  // Same "incomplete draft blocks the action it feeds" convention as the
  // per-field null-rate hardening check's own rows — every target field
  // needs a chosen source before "Generate" is allowed.
  function mappingIsComplete(targetFieldNames, draft) {
    return targetFieldNames.length > 0 && targetFieldNames.every(name => !!draft[name]);
  }

  // ── Per-scrape source-field mapping draft (Tree) ────────────────────────
  // The draft is keyed by each leaf's own path within the fetched target
  // tree (dot-joined child indices, e.g. "0.1" — same addressing scheme
  // the container/DOM tree views already use, just stringified since it's
  // a plain object key here rather than an array threaded through
  // recursive calls) rather than by name, since two leaves may share a name
  // in different branches (mirrors container mode's own tree allowing
  // duplicate sibling names).

  function walkTreeLeafPaths(nodes, prefix, visit) {
    nodes.forEach((node, i) => {
      const path = prefix ? `${prefix}.${i}` : `${i}`;
      if (Array.isArray(node.children)) walkTreeLeafPaths(node.children, path, visit);
      else visit(path, node);
    });
  }

  function createTreeMappingDraft(tree) {
    const draft = {};
    walkTreeLeafPaths(tree || [], '', (path) => { draft[path] = null; });
    return draft;
  }

  function updateTreeMappingSource(draft, leafPath, sourceField) {
    return { ...draft, [leafPath]: sourceField || null };
  }

  function treeMappingIsComplete(tree, draft) {
    if (!tree || tree.length === 0) return false;
    let complete = true;
    walkTreeLeafPaths(tree, '', (path) => { if (!draft[path]) complete = false; });
    return complete;
  }

  // Builds the wire-shaped OutputBlueprintTreeMappingNode[] — mirrors the
  // fetched target tree node-for-node, attaching each leaf's picked source
  // field from `draft`.
  function buildOutputBlueprintTreeMappingNodes(nodes, draft, prefix) {
    return nodes.map((node, i) => {
      const path = prefix ? `${prefix}.${i}` : `${i}`;
      return Array.isArray(node.children)
        ? { name: node.name, children: buildOutputBlueprintTreeMappingNodes(node.children, draft, path) }
        : { name: node.name, sourceField: draft[path] };
    });
  }

  // Returns the wire-shaped OutputBlueprintMapping, or null when there's no
  // blueprint picked or the mapping isn't complete yet — same "incomplete
  // draft = null, toggle-off-equivalent" convention buildProxyConfig/
  // buildChangeDetectionConfig already establish, so buildScrapingConfig's
  // own "only include the key when truthy" spread pattern works unchanged.
  // blueprintId is the <select>'s own string value (e.g. "3") — parsed to a
  // number here since that's what the wire format's BlueprintId expects.
  // Issue #244: schemaKind picks which of (targetFieldNames, draft) / (tree,
  // treeDraft) is meaningful — the other pair is simply ignored, the same
  // way the companion's own OutputBlueprintMapping carries both Fields/Tree
  // but only ever populates the one matching SchemaKind.
  function buildOutputBlueprintMapping(blueprintId, schemaKind, targetFieldNames, draft, tree, treeDraft) {
    if (!blueprintId) return null;
    if (schemaKind === 'Tree') {
      if (!treeMappingIsComplete(tree, treeDraft)) return null;
      return { blueprintId: parseInt(blueprintId, 10), schemaKind: 'Tree', tree: buildOutputBlueprintTreeMappingNodes(tree, treeDraft, '') };
    }
    if (!mappingIsComplete(targetFieldNames, draft)) return null;
    return {
      blueprintId: parseInt(blueprintId, 10),
      schemaKind: 'Flat',
      fields: targetFieldNames.map(target => ({ targetField: target, sourceField: draft[target] })),
    };
  }

  return {
    addBlueprintFieldName, removeBlueprintFieldName, updateBlueprintFieldName, moveBlueprintFieldName,
    blueprintDraftIsValid, parseFieldNamesFromSample,
    buildBlueprintSchemaGroup, buildBlueprintSchemaField, parseBlueprintSchemaTree, serializeBlueprintSchemaTree,
    blueprintTreeSchemaIsValid,
    createMappingDraft, updateMappingSource, mappingIsComplete,
    createTreeMappingDraft, updateTreeMappingSource, treeMappingIsComplete,
    buildOutputBlueprintMapping,
  };
})();

if (typeof module !== 'undefined') module.exports = SFOutputBlueprints;
if (typeof self !== 'undefined') self.SFOutputBlueprints = SFOutputBlueprints;
