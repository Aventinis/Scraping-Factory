// @ts-check
// Issue #84: pure, DOM-free helpers for a field's transform chain (trim/
// regexExtract/replace/toNumber, applied in order — mirrors the backend
// IR's FieldTransform.cs). Split out the same way container-tree.js/
// api-config.js are. Object shape already matches the
// wire format 1:1 (camelCase keys = the companion's own JSON property
// names), so there's no separate serialize step the way container-tree.js's
// serializeGroupTree needs one — these objects are sent as-is.
//
// Issue #238: JSDoc-annotated and typechecked via `// @ts-check` + tsconfig
// (`npm run typecheck`) — every exported function's wire-shape inputs/
// outputs are typed against types/companion-ir.d.ts's SFWire namespace; a
// transform kind string is narrowed with `/** @type {...} */` casts at the
// few spots TypeScript's control-flow narrowing can't follow (a `switch` on
// `t.kind` inside a loop where `value` itself changes type per-iteration).
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

// Switching kind starts that step over with fresh defaults rather than
// trying to carry over unrelated fields (e.g. a "replace" step's find/
// replacement wouldn't mean anything on a "trim" step).
/**
 * @param {SFWire.FieldTransform[]} transforms
 * @param {number} index
 * @param {SFWire.FieldTransform['kind']} kind
 * @returns {SFWire.FieldTransform[]}
 */
function changeTransformKind(transforms, index, kind) {
  return transforms.map((t, i) => (i === index ? createDefaultTransform(kind) : t));
}

// direction: -1 (up) or +1 (down). Out-of-range moves are a no-op rather
// than clamped/wrapped — the UI already disables the button at either end
// (see field-transforms-ui.js), this is just the data-layer safety net.
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

// Blocks "Hinzufügen" the same way an empty "Attribut" input already does
// for Attribute mode (see confirmExtendedField) — an empty regex pattern
// can never usefully match anything, so failing fast here avoids a round
// trip to the companion's own FieldTransformValidator just to learn the
// same thing. Issue #205: a blank toDate sourceFormat is the same kind of
// "can never usefully match anything" case; toInteger/toBoolean's
// onError/defaultValue never reach an invalid state through this UI (the
// default value input always starts at '', never null), so they need no
// check here.
// Issue #206: combineFields needs at least 2 picked source fields (the
// multi-select itself can obviously end up empty/single right after
// switching to this kind); splitField needs a picked source field —
// mirrors FieldTransformValidator's own structural checks companion-side,
// just surfaced here before a round trip is even attempted.
/**
 * @param {SFWire.FieldTransform[]} transforms
 * @returns {boolean}
 */
function transformsAreValid(transforms) {
  return transforms.every(t => {
    if (t.kind === 'regexExtract') return t.pattern.trim() !== '';
    // sourceFormat is optional on the wire (falls back to the ISO default
    // server-side), but this UI always starts it at a non-blank default —
    // `?? ''` only guards the type, never actually fires in practice.
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

// _to_number ends with float() and str(): "12.90" becomes "12.9", "100.0" becomes "100", a whole
// number is printed without exponent however large. BigInt gives the exact digits Python's int()
// prints for a whole float.
/**
 * @param {string} text
 * @returns {string}
 */
function normalizeNumber(text) {
  const numeric = Number(text);
  if (Number.isNaN(numeric)) return '';
  return Number.isInteger(numeric) ? BigInt(numeric).toString() : String(numeric);
}

// Issue #205: JS mirrors of the runtime's _to_integer/_to_boolean/_to_date
// (fragments/transforms.py.j2), pinned by test-vectors/transforms.json. Each
// returns null on conversion failure (distinct from a valid, possibly
// empty, converted string) so applyTransformsPreview below can apply the
// transform's own onError/defaultValue the same way _apply_transforms
// does, rather than the generic "preview unavailable" regexExtract uses
// for an outright invalid pattern.
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
  // A structural match doesn't guarantee a real calendar date (e.g.
  // "2026-02-30") — JS's own Date rolls invalid day-of-month values over
  // into the next month instead of raising, so the roll-over is detected
  // by checking the constructed date's own fields didn't move, the same
  // check Python's date() raising ValueError gives us for free server-side.
  // Python's date() starts at year 1, so "0000" is a failure there too.
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

// Mirror of the runtime's _to_currency (pinned by test-vectors/transforms.json):
// the first number in the value — a separator only counts when a digit
// follows — must match the chosen format strictly (thousands groups of
// exactly three digits, at most one decimal separator); the fraction is
// kept exactly as scraped. [0-9] rather than \d on both sides, since
// Python's \d also matches non-ASCII digits and JS's doesn't.
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

// converted is the conversion's own result: a converted string on
// success, or null on failure (see toIntegerPreview/toBooleanPreview/
// toDatePreview above). On failure this applies the transform's own
// onError contract exactly like the Python runtime's
// _type_conversion_fallback: "KeepOriginal" passes currentValue through
// unchanged (the chain keeps going, it does NOT mean "preview
// unavailable"), "UseDefault" substitutes defaultValue.
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
        // Issue #206: no sibling field's own value is available client-side
        // at preview time (this preview only ever has the *one* field
        // currently being edited's own picked raw value, see
        // renderTransformPreview's own doc comment) — null signals
        // "preview unavailable" here, the same as an invalid regexExtract
        // pattern, rather than misleadingly showing this field's own raw
        // value untouched.
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

