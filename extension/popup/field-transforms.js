// @ts-check
/** @import * as SFWire from '../types/wire' */
// Pure, DOM-free helpers for a field's transform chain (applied in order; mirrors the IR's FieldTransform.cs). The
// objects already match the wire format 1:1, so there is no serialize step. Typed against SFWire; a `switch` on
// `t.kind` inside a loop needs a few `@type` casts where narrowing cannot follow.
/**
 * @param {SFWire.FieldTransform['kind']} kind
 * @returns {SFWire.FieldTransform}
 */
function createDefaultTransform(kind) {
  switch (kind) {
    case 'regexExtract': return { kind: 'regexExtract', pattern: '', group: 0 };
    case 'replace': return { kind: 'replace', find: '', replacement: '' };
    case 'toNumber': return { kind: 'toNumber' };
    case 'toInteger': return { kind: 'toInteger', onError: 'KeepOriginal', defaultValue: '' };
    case 'toBoolean': return { kind: 'toBoolean', onError: 'KeepOriginal', defaultValue: '' };
    case 'toDate': return { kind: 'toDate', sourceFormat: '{yyyy}-{mm}-{dd}', onError: 'KeepOriginal', defaultValue: '' };
    case 'toCurrency': return { kind: 'toCurrency', format: '1.234,56', onError: 'KeepOriginal', defaultValue: '' };
    case 'combineFields': return { kind: 'combineFields', sourceFieldNames: [], separator: ' ' };
    case 'splitField': return { kind: 'splitField', sourceFieldName: '', separator: ' ', index: 0 };
    case 'trim':
    default: return { kind: 'trim' };
  }
}

/**
 * @param {SFWire.FieldTransform[]} transforms
 * @returns {SFWire.FieldTransform[]}
 */
function addTransform(transforms) {
  return [...transforms, createDefaultTransform('trim')];
}

/**
 * @param {SFWire.FieldTransform[]} transforms
 * @param {number} index
 * @returns {SFWire.FieldTransform[]}
 */
function removeTransform(transforms, index) {
  return transforms.filter((_, i) => i !== index);
}

/**
 * `patch` is intentionally untyped beyond a plain record — it carries
 * whichever kind-specific fields the currently-open modal's own inputs
 * happen to produce (pattern/group, find/replacement, onError/
 * defaultValue, ...), which only a per-kind union could express
 * precisely, and TypeScript's `Partial<T>` over `T` already a union
 * doesn't meaningfully narrow that for a generic patch merge anyway.
 * @param {SFWire.FieldTransform[]} transforms
 * @param {number} index
 * @param {Record<string, unknown>} patch
 * @returns {SFWire.FieldTransform[]}
 */
function updateTransform(transforms, index, patch) {
  return transforms.map((t, i) => (i === index ? { ...t, ...patch } : t));
}

// Switching kind starts the step over with fresh defaults (a "replace" step's fields mean nothing on "trim").
/**
 * @param {SFWire.FieldTransform[]} transforms
 * @param {number} index
 * @param {SFWire.FieldTransform['kind']} kind
 * @returns {SFWire.FieldTransform[]}
 */
function changeTransformKind(transforms, index, kind) {
  return transforms.map((t, i) => (i === index ? createDefaultTransform(kind) : t));
}

// direction: -1 (up) or +1 (down). Out of range is a no-op; the UI disables the buttons at the ends.
/**
 * @param {SFWire.FieldTransform[]} transforms
 * @param {number} index
 * @param {number} direction
 * @returns {SFWire.FieldTransform[]}
 */
function moveTransform(transforms, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= transforms.length) return transforms;
  const copy = [...transforms];
  [copy[index], copy[target]] = [copy[target], copy[index]];
  return copy;
}

// Blocks "Add" like an empty attribute input does: an empty regex pattern or toDate format can never match, so fail
// fast instead of a round trip. combineFields needs at least 2 source fields, splitField one (as the companion's
// FieldTransformValidator). toInteger / toBoolean never reach an invalid state through the UI.
/**
 * @param {SFWire.FieldTransform[]} transforms
 * @returns {boolean}
 */
function transformsAreValid(transforms) {
  return transforms.every(t => {
    if (t.kind === 'regexExtract') return t.pattern.trim() !== '';
    // Optional on the wire, but the UI always starts it non-blank; `?? ''` only satisfies the type.
    if (t.kind === 'toDate') return (t.sourceFormat ?? '').trim() !== '';
    if (t.kind === 'combineFields') return t.sourceFieldNames.length >= 2;
    if (t.kind === 'splitField') return t.sourceFieldName.trim() !== '';
    return true;
  });
}

// Issue #143: JS mirror of the runtime's _to_number (fragments/transforms.py.j2);
// test-vectors/transforms.json pins both to the same results.
/**
 * @param {string} value
 * @returns {string}
 */
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
    return normalizeNumber(`${integerPart}.${fractionalPart}`);
  }
  if ((raw.match(/,/g) || []).length > 1 || (raw.match(/\./g) || []).length > 1) {
    return normalizeNumber(raw.replace(/[.,]/g, ''));
  }
  return normalizeNumber(raw.replace(',', '.'));
}

// _to_number ends with float() and str(): "12.90" gives "12.9", "100.0" gives "100", a whole number never uses an
// exponent. BigInt gives the digits Python's int() prints for a whole float.
/**
 * @param {string} text
 * @returns {string}
 */
function normalizeNumber(text) {
  const numeric = Number(text);
  if (Number.isNaN(numeric)) return '';
  return Number.isInteger(numeric) ? BigInt(numeric).toString() : String(numeric);
}

// JS mirrors of the runtime's _to_integer / _to_boolean / _to_date (pinned by test-vectors/transforms.json). null means
// conversion failure (distinct from a valid empty string) so applyTransformsPreview can apply the transform's own
// onError / defaultValue.
/**
 * @param {string} value
 * @returns {string | null}
 */
function toIntegerPreview(value) {
  const trimmed = value.trim();
  // BigInt, not parseInt: Python's int() keeps every digit of a long number.
  return /^[+-]?\d+$/.test(trimmed) ? BigInt(trimmed).toString() : null;
}

/**
 * @param {string} value
 * @returns {string | null}
 */
function toBooleanPreview(value) {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return 'True';
  if (['false', '0', 'no', 'n'].includes(normalized)) return 'False';
  return null;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExpLiteral(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DATE_FORMAT_TOKEN_PATTERNS = { yyyy: '(?<yyyy>\\d{4})', mm: '(?<mm>\\d{1,2})', dd: '(?<dd>\\d{1,2})' };

// Mirrors RangeFormat.CompilePattern: the literal template is escaped, then each "{token}" becomes a named group.
// sourceFormat is never regex syntax, so any mismatch (shape, token, non-existent date) is just a conversion failure
// for onError.
/**
 * @param {string} value
 * @param {string} sourceFormat
 * @returns {string | null}
 */
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
  // setUTCFullYear, not Date.UTC: Date.UTC maps the years 0-99 to 1900-1999.
  const d = new Date(0);
  d.setUTCFullYear(yyyy, mm - 1, dd);
  // A structural match is not a real date ("2026-02-30"): JS's Date rolls over instead of raising, so check the
  // fields did not move (Python's date() raises). Year 0 fails there too, since date() starts at year 1.
  if (yyyy < 1 || d.getUTCFullYear() !== yyyy || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
  /** @param {number} n */
  const pad = (n) => String(n).padStart(2, '0');
  return `${String(yyyy).padStart(4, '0')}-${pad(mm)}-${pad(dd)}`;
}

// Issue #234: decimal separator and accepted thousands separator(s) per
// ToCurrencyTransform.SupportedFormats preset (the vectors cover each preset).
/** @type {Record<string, {decimal: string, thousands: string}>} */
const CURRENCY_FORMATS = {
  '1.234,56': { decimal: ',', thousands: '.' },
  '1,234.56': { decimal: '.', thousands: ',' },
  '1 234,56': { decimal: ',', thousands: ' \u00a0\u202f' },
  "1'234.56": { decimal: '.', thousands: "'\u2019" },
};
const CURRENCY_FORMAT_IDS = Object.keys(CURRENCY_FORMATS);

/**
 * @param {string} chars
 * @returns {string}
 */
function escapeCharClass(chars) {
  return chars.replace(/[\]\\^-]/g, '\\$&');
}

// Mirror of the runtime's _to_currency (pinned by test-vectors/transforms.json): the first number (a separator only
// counts before a digit) must match the format strictly; the fraction is kept as scraped. [0-9] instead of \d because
// Python's \d also matches non-ASCII digits.
/**
 * @param {string} value
 * @param {string} format
 * @returns {string | null}
 */
function toCurrencyPreview(value, format) {
  const { decimal, thousands } = CURRENCY_FORMATS[format] || CURRENCY_FORMATS['1.234,56'];
  const candidate = new RegExp(`[+-]?[0-9](?:[0-9]|[${escapeCharClass(decimal + thousands)}](?=[0-9]))*`).exec(value);
  if (!candidate) return null;
  const thousandsClass = `[${escapeCharClass(thousands)}]`;
  const match = new RegExp(`^([+-]?)([0-9]{1,3}(?:${thousandsClass}[0-9]{3})+|[0-9]+)(?:${decimal === '.' ? '\\.' : decimal}([0-9]+))?$`)
    .exec(candidate[0]);
  if (!match) return null;
  // Leading zeros stripped textually (not via parseInt, which loses
  // precision on very long amounts) — same result as Python's str(int(...)).
  const integer = match[2].replace(new RegExp(thousandsClass, 'g'), '').replace(/^0+(?=[0-9])/, '');
  return `${match[1] === '-' ? '-' : ''}${integer}${match[3] ? `.${match[3]}` : ''}`;
}

// converted is the conversion's result, or null on failure; on failure the transform's onError applies like
// _type_conversion_fallback: KeepOriginal passes currentValue through (the chain goes on), UseDefault substitutes
// defaultValue.
/**
 * @param {string} currentValue
 * @param {SFWire.ToIntegerTransform | SFWire.ToBooleanTransform | SFWire.ToDateTransform | SFWire.ToCurrencyTransform} t
 * @param {string | null} converted
 * @returns {string}
 */
function typeConversionFallback(currentValue, t, converted) {
  if (converted !== null) return converted;
  return t.onError === 'UseDefault' ? (t.defaultValue ?? '') : currentValue;
}

// Applies the chain to a raw picked value like _apply_transforms, for the live preview. regexExtract uses JS's RegExp,
// not Python's re, so a pattern that does not compile as a JS RegExp returns null ("preview unavailable"), distinct
// from a valid empty result.
/**
 * @param {string} rawValue
 * @param {SFWire.FieldTransform[]} transforms
 * @returns {string | null}
 */
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
        // A function replacer, so "$&"/"$1" in the replacement stay literal text, like Python's str.replace.
        value = value.replaceAll(t.find, () => t.replacement);
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
      case 'toCurrency':
        value = typeConversionFallback(value, t, toCurrencyPreview(value, t.format || '1.234,56'));
        break;
      case 'combineFields':
      case 'splitField':
        // No sibling value exists client-side: null, "preview unavailable", rather than showing the raw value untouched.
        return null;
    }
  }
  return value;
}

module.exports = {
  createDefaultTransform, addTransform, removeTransform, updateTransform,
  changeTransformKind, moveTransform, transformsAreValid,
  toNumberPreview, toIntegerPreview, toBooleanPreview, toDatePreview, toCurrencyPreview, CURRENCY_FORMAT_IDS,
  applyTransformsPreview,
};

