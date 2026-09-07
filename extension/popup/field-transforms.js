// Issue #84: pure, DOM-free helpers for a field's transform chain (trim/
// regexExtract/replace/toNumber, applied in order — mirrors the backend
// IR's FieldTransform.cs). Split out the same way container-tree.js/
// api-config.js are: popup.html loads this as a classic <script> before
// popup.js/container-tree-ui.js, which pull what they need off
// `self.SFFieldTransforms` — a bare top-level `const`/`function` here would
// collide with popup.js's own declarations, since classic scripts sharing
// one document all share one global scope. Object shape already matches the
// wire format 1:1 (camelCase keys = the companion's own JSON property
// names), so there's no separate serialize step the way container-tree.js's
// serializeGroupTree needs one — these objects are sent as-is.
const SFFieldTransforms = (function () {
  function createDefaultTransform(kind) {
    switch (kind) {
      case 'regexExtract': return { kind: 'regexExtract', pattern: '', group: 0 };
      case 'replace': return { kind: 'replace', find: '', replacement: '' };
      case 'toNumber': return { kind: 'toNumber' };
      case 'trim':
      default: return { kind: 'trim' };
    }
  }

  function addTransform(transforms) {
    return [...transforms, createDefaultTransform('trim')];
  }

  function removeTransform(transforms, index) {
    return transforms.filter((_, i) => i !== index);
  }

  function updateTransform(transforms, index, patch) {
    return transforms.map((t, i) => (i === index ? { ...t, ...patch } : t));
  }

  // Switching kind starts that step over with fresh defaults rather than
  // trying to carry over unrelated fields (e.g. a "replace" step's find/
  // replacement wouldn't mean anything on a "trim" step).
  function changeTransformKind(transforms, index, kind) {
    return transforms.map((t, i) => (i === index ? createDefaultTransform(kind) : t));
  }

  // direction: -1 (up) or +1 (down). Out-of-range moves are a no-op rather
  // than clamped/wrapped — the UI already disables the button at either end
  // (see field-transforms-ui.js), this is just the data-layer safety net.
  function moveTransform(transforms, index, direction) {
    const target = index + direction;
    if (target < 0 || target >= transforms.length) return transforms;
    const copy = [...transforms];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    return copy;
  }

  // Blocks "Hinzufügen" the same way an empty "Attribut" input already does
  // for Attribute mode (see confirmExtendedField) — an empty regex pattern
  // can never usefully match anything, so failing fast here avoids a round
  // trip to the companion's own FieldTransformValidator just to learn the
  // same thing.
  function transformsAreValid(transforms) {
    return transforms.every(t => t.kind !== 'regexExtract' || t.pattern.trim() !== '');
  }

  return {
    createDefaultTransform, addTransform, removeTransform, updateTransform,
    changeTransformKind, moveTransform, transformsAreValid,
  };
})();

if (typeof module !== 'undefined') module.exports = SFFieldTransforms;
if (typeof self !== 'undefined') self.SFFieldTransforms = SFFieldTransforms;
