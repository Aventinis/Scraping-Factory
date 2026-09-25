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
    blueprintDraftIsValid,
    buildBlueprintSchemaGroup, buildBlueprintSchemaField, parseBlueprintSchemaTree, serializeBlueprintSchemaTree,
    blueprintTreeSchemaIsValid,
    createMappingDraft, updateMappingSource, mappingIsComplete,
    createTreeMappingDraft, updateTreeMappingSource, treeMappingIsComplete,
    buildOutputBlueprintMapping,
  };
})();

if (typeof module !== 'undefined') module.exports = SFOutputBlueprints;
if (typeof self !== 'undefined') self.SFOutputBlueprints = SFOutputBlueprints;
