// Issue #191: pure, DOM-free helpers for Output Blueprints — both editing a
// blueprint's own ordered target-field-name list (create/edit modal) and
// building/validating the per-scrape source-field mapping draft (once a
// blueprint is picked on the idle screen). Split the same way
// combined-config.js/field-transforms.js are: no fetch, no DOM, just data.
const SFOutputBlueprints = (function () {
  // ── Editing a blueprint's own field-name list (create/edit modal) ──────

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

  // ── Per-scrape source-field mapping draft ───────────────────────────────

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

  // Returns the wire-shaped OutputBlueprintMapping, or null when there's no
  // blueprint picked or the mapping isn't complete yet — same "incomplete
  // draft = null, toggle-off-equivalent" convention buildProxyConfig/
  // buildChangeDetectionConfig already establish, so buildScrapingConfig's
  // own "only include the key when truthy" spread pattern works unchanged.
  // blueprintId is the <select>'s own string value (e.g. "3") — parsed to a
  // number here since that's what the wire format's BlueprintId expects.
  function buildOutputBlueprintMapping(blueprintId, targetFieldNames, draft) {
    if (!blueprintId || !mappingIsComplete(targetFieldNames, draft)) return null;
    return {
      blueprintId: parseInt(blueprintId, 10),
      fields: targetFieldNames.map(target => ({ targetField: target, sourceField: draft[target] })),
    };
  }

  return {
    addBlueprintFieldName, removeBlueprintFieldName, updateBlueprintFieldName, moveBlueprintFieldName,
    blueprintDraftIsValid,
    createMappingDraft, updateMappingSource, mappingIsComplete, buildOutputBlueprintMapping,
  };
})();

if (typeof module !== 'undefined') module.exports = SFOutputBlueprints;
if (typeof self !== 'undefined') self.SFOutputBlueprints = SFOutputBlueprints;
