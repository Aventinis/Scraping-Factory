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

  // Issue #143: hand-kept JS mirror of the Python runtime's own _to_number
  // (see any of the six .py.j2 templates) — same "both sides must
  // independently reach the same result" pattern as sanitizeFileNameBase's
  // relationship to the companion's FileNameSanitizer, since this only ever
  // has to *look* right in the popup, never actually run server-side.
  function toNumberPreview(value) {
    const match = value.match(/-?\d[\d.,]*/);
    if (!match) return '';
    const raw = match[0];
    const lastDot = raw.lastIndexOf('.');
    const lastComma = raw.lastIndexOf(',');
    if (lastDot !== -1 && lastComma !== -1) {
      const decimalPos = Math.max(lastDot, lastComma);
      const integerPart = raw.slice(0, decimalPos).replace(/[.,]/g, '');
      const fractionalPart = raw.slice(decimalPos + 1);
      return `${integerPart}.${fractionalPart}`;
    }
    if ((raw.match(/,/g) || []).length > 1 || (raw.match(/\./g) || []).length > 1) {
      return raw.replace(/[.,]/g, '');
    }
    return raw.replace(',', '.');
  }

  // Issue #143: applies the chain against a raw picked value the same way
  // _apply_transforms does at runtime, for a live "what would this produce"
  // preview while the user is still editing the chain — no companion round
  // trip. regexExtract runs through JS's own RegExp/exec rather than
  // Python's `re.search`, which is the same "not 100% syntax-identical"
  // known risk already documented on RegexExtractTransform/
  // FieldTransformValidator — a pattern that fails to compile as a JS
  // RegExp makes this return null (distinct from a valid empty-string
  // result) so the caller can show "preview unavailable" instead of a wrong
  // value.
  function applyTransformsPreview(rawValue, transforms) {
    let value = rawValue;
    for (const t of transforms) {
      switch (t.kind) {
        case 'trim':
          value = value.trim();
          break;
        case 'regexExtract': {
          if (!t.pattern) { value = ''; break; }
          let match;
          try {
            match = new RegExp(t.pattern).exec(value);
          } catch (err) {
            return null;
          }
          const group = match ? match[t.group ?? 0] : undefined;
          value = group !== undefined ? group : '';
          break;
        }
        case 'replace':
          value = value.replaceAll(t.find, t.replacement);
          break;
        case 'toNumber':
          value = toNumberPreview(value);
          break;
      }
    }
    return value;
  }

  return {
    createDefaultTransform, addTransform, removeTransform, updateTransform,
    changeTransformKind, moveTransform, transformsAreValid,
    toNumberPreview, applyTransformsPreview,
  };
})();

if (typeof module !== 'undefined') module.exports = SFFieldTransforms;
if (typeof self !== 'undefined') self.SFFieldTransforms = SFFieldTransforms;
