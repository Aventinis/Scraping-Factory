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
      case 'toInteger': return { kind: 'toInteger', onError: 'KeepOriginal', defaultValue: '' };
      case 'toBoolean': return { kind: 'toBoolean', onError: 'KeepOriginal', defaultValue: '' };
      case 'toDate': return { kind: 'toDate', sourceFormat: '{yyyy}-{mm}-{dd}', onError: 'KeepOriginal', defaultValue: '' };
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
  // same thing. Issue #205: a blank toDate sourceFormat is the same kind of
  // "can never usefully match anything" case; toInteger/toBoolean's
  // onError/defaultValue never reach an invalid state through this UI (the
  // default value input always starts at '', never null), so they need no
  // check here.
  function transformsAreValid(transforms) {
    return transforms.every(t => {
      if (t.kind === 'regexExtract') return t.pattern.trim() !== '';
      if (t.kind === 'toDate') return t.sourceFormat.trim() !== '';
      return true;
    });
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

  // Issue #205: hand-kept JS mirrors of the Python runtime's own
  // _to_integer/_to_boolean/_to_date (see any of the eight .py.j2
  // templates) — same "both sides must independently reach the same
  // result" pattern toNumberPreview already has to _to_number. Each
  // returns null on conversion failure (distinct from a valid, possibly
  // empty, converted string) so applyTransformsPreview below can apply the
  // transform's own onError/defaultValue the same way _apply_transforms
  // does, rather than the generic "preview unavailable" regexExtract uses
  // for an outright invalid pattern.
  function toIntegerPreview(value) {
    const trimmed = value.trim();
    return /^[+-]?\d+$/.test(trimmed) ? String(parseInt(trimmed, 10)) : null;
  }

  function toBooleanPreview(value) {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return 'True';
    if (['false', '0', 'no', 'n'].includes(normalized)) return 'False';
    return null;
  }

  function escapeRegExpLiteral(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const DATE_FORMAT_TOKEN_PATTERNS = { yyyy: '(?<yyyy>\\d{4})', mm: '(?<mm>\\d{1,2})', dd: '(?<dd>\\d{1,2})' };

  // Mirrors RangeFormat.cs's CompilePattern (escape the literal template,
  // then substitute each "{token}" placeholder for its own named capture
  // group) — the same mini-template syntax RangeSource.Format already uses
  // for ISO week/date API parameters. Unlike RegexExtractTransform.Pattern,
  // sourceFormat is never itself treated as regex syntax (every character
  // that isn't one of the three known tokens is escaped first), so — unlike
  // regexExtract's "invalid pattern" case — there's no "the format itself
  // is broken" outcome to report separately; any mismatch (wrong shape,
  // wrong token, or a structurally-valid but non-existent calendar date)
  // is just a conversion failure, handled by the caller's onError contract.
  function toDatePreview(value, sourceFormat) {
    let pattern = escapeRegExpLiteral(sourceFormat);
    for (const [token, tokenPattern] of Object.entries(DATE_FORMAT_TOKEN_PATTERNS)) {
      pattern = pattern.replaceAll(escapeRegExpLiteral(`{${token}}`), tokenPattern);
    }
    const match = new RegExp(`^${pattern}$`).exec(value.trim());
    if (!match || !match.groups) return null;
    const yyyy = parseInt(match.groups.yyyy, 10);
    const mm = parseInt(match.groups.mm, 10);
    const dd = parseInt(match.groups.dd, 10);
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    // A structural match doesn't guarantee a real calendar date (e.g.
    // "2026-02-30") — JS's own Date rolls invalid day-of-month values over
    // into the next month instead of raising, so the roll-over is detected
    // by checking the constructed date's own fields didn't move, the same
    // check Python's date() raising ValueError gives us for free server-side.
    if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return `${yyyy}-${pad(mm)}-${pad(dd)}`;
  }

  // converted is the conversion's own result: a converted string on
  // success, or null on failure (see toIntegerPreview/toBooleanPreview/
  // toDatePreview above). On failure this applies the transform's own
  // onError contract exactly like the Python runtime's
  // _type_conversion_fallback: "KeepOriginal" passes currentValue through
  // unchanged (the chain keeps going, it does NOT mean "preview
  // unavailable"), "UseDefault" substitutes defaultValue.
  function typeConversionFallback(currentValue, t, converted) {
    if (converted !== null) return converted;
    return t.onError === 'UseDefault' ? (t.defaultValue ?? '') : currentValue;
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
        case 'toInteger':
          value = typeConversionFallback(value, t, toIntegerPreview(value));
          break;
        case 'toBoolean':
          value = typeConversionFallback(value, t, toBooleanPreview(value));
          break;
        case 'toDate':
          value = typeConversionFallback(value, t, toDatePreview(value, t.sourceFormat || ''));
          break;
      }
    }
    return value;
  }

  return {
    createDefaultTransform, addTransform, removeTransform, updateTransform,
    changeTransformKind, moveTransform, transformsAreValid,
    toNumberPreview, toIntegerPreview, toBooleanPreview, toDatePreview,
    applyTransformsPreview,
  };
})();

if (typeof module !== 'undefined') module.exports = SFFieldTransforms;
if (typeof self !== 'undefined') self.SFFieldTransforms = SFFieldTransforms;
