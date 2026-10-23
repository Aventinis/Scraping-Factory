// Issue #206 follow-up: pure, DOM-free helpers backing the dedicated
// "Felder kombinieren"/"Feld aufteilen" field creation flow — replaces the
// original Issue #206 design, where combineFields/splitField were just two
// more kinds in the generic per-field transform-chain editor
// (field-transforms.ts/-ui.js), reachable only by first faking a normal
// field (a click-based selector pick the resulting value never actually
// uses). A combine/split-derived field has no selector/path of its own —
// its whole value comes from other already-configured sibling fields — so
// it gets its own creation modal instead (combine-split-fields-ui.js),
// never a click-based pick.
// True when `transforms` is exactly the shape the dedicated creation flow
// below produces: a single combineFields/splitField transform, nothing
// else. Mirrors the companion's own ScrapingPlanValidator.IsDerivedField
// (same "must be the first transform" rule) — used by every mode's own
// row renderer to show a distinguishing label instead of a (functionally
// unused) selector/path.
function isDerivedField(transforms) {
  return Array.isArray(transforms) && transforms.length > 0 &&
    (transforms[0].kind === 'combineFields' || transforms[0].kind === 'splitField');
}

// Issue #407: the split modal shows "Part (1 = first)" — people count from
// one — while the wire format (SplitFieldTransform.Index) stays 0-based.
// These two are the only place the +1/-1 lives.
function partNumberToIndex(partNumber) {
  return Number.isFinite(partNumber) && partNumber >= 1 ? Math.floor(partNumber) - 1 : 0;
}

function indexToPartNumber(index) {
  return Number.isFinite(index) && index >= 0 ? Math.floor(index) + 1 : 1;
}

function buildCombineFieldsTransform(sourceFieldNames, separator) {
  return { kind: 'combineFields', sourceFieldNames, separator: separator || ' ' };
}

function buildSplitFieldTransform(sourceFieldName, separator, index) {
  return { kind: 'splitField', sourceFieldName, separator: separator || ' ', index: Number.isFinite(index) && index >= 0 ? index : 0 };
}

// Same structural checks field-transforms.ts's own transformsAreValid
// already applies to these two kinds when they could still appear inside
// an arbitrary chain — exposed directly here since the dedicated modals
// below only ever build one transform at a time, not a whole chain.
function combineFieldsIsValid(sourceFieldNames) {
  return Array.isArray(sourceFieldNames) && sourceFieldNames.length >= 2;
}

function splitFieldIsValid(sourceFieldName) {
  return !!sourceFieldName && sourceFieldName.trim() !== '';
}

module.exports = {
  isDerivedField, buildCombineFieldsTransform, buildSplitFieldTransform,
  combineFieldsIsValid, splitFieldIsValid, partNumberToIndex, indexToPartNumber,
};

