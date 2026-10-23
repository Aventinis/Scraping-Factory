// @ts-check
// Pure logic of the two transform-editor helpers that get a non-programmer to a working value: the regex "recipes" behind "Regex extract" and
// the date-format inference behind "Convert to date" (transform-helpers-ui.js renders them).
//
// Recipes turn "the text after Price:" into a pattern + group. The user's text is escaped, and only constructs that .NET's Regex (the companion's
// validation) and Python's re (the script) read identically are used: groups, \d, \s, [^...], lazy +?; no lookbehind, named groups or inline
// flags. The pattern stays editable in the normal input.
const { applyTransformsPreview, toDatePreview } = require('./field-transforms');

/**
 * @param {string} text
 * @returns {string} `text` with every regex metacharacter escaped
 */
function escapeRegexLiteral(text) {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

// What each recipe asks for: `args` literal texts, or (brackets) a choice.
/** @type {ReadonlyArray<{ id: string, args: number, choice?: string[] }>} */
const RECIPES = [
  { id: 'firstNumber', args: 0 },
  { id: 'digits', args: 0 },
  { id: 'textAfter', args: 1 },
  { id: 'textBefore', args: 1 },
  { id: 'textBetween', args: 2 },
  { id: 'brackets', args: 0, choice: ['(', '[', '{', '<'] },
];

const BRACKET_CLOSERS = { '(': ')', '[': ']', '{': '}', '<': '>' };

/**
 * The pattern and capture group for a recipe, or null while it still lacks the
 * text(s) it asks for.
 * @param {string} id
 * @param {string[]} [args]
 * @returns {{ pattern: string, group: number } | null}
 */
function buildRecipe(id, args = []) {
  const [a, b] = args.map((arg) => String(arg ?? '').trim());
  switch (id) {
    case 'firstNumber':
      return { pattern: '-?\\d+(?:[.,]\\d+)*', group: 0 };
    case 'digits':
      return { pattern: '\\d+', group: 0 };
    case 'textAfter':
      return a ? { pattern: `${escapeRegexLiteral(a)}\\s*(.+)`, group: 1 } : null;
    case 'textBefore':
      return a ? { pattern: `(.+?)\\s*${escapeRegexLiteral(a)}`, group: 1 } : null;
    case 'textBetween':
      return a && b ? { pattern: `${escapeRegexLiteral(a)}\\s*(.+?)\\s*${escapeRegexLiteral(b)}`, group: 1 } : null;
    case 'brackets': {
      const open = a in BRACKET_CLOSERS ? a : '(';
      const close = BRACKET_CLOSERS[/** @type {keyof typeof BRACKET_CLOSERS} */ (open)];
      return { pattern: `${escapeRegexLiteral(open)}([^${close === ']' ? '\\]' : close}]*)${escapeRegexLiteral(close)}`, group: 1 };
    }
    default:
      return null;
  }
}

/**
 * What a recipe would extract from a value — the same result the editor's own
 * live preview gives once the pattern is applied. null = no match / recipe
 * incomplete / pattern the preview can't run.
 * @param {string} rawValue
 * @param {{ pattern: string, group: number } | null} recipe
 * @returns {string | null}
 */
function previewRecipe(rawValue, recipe) {
  if (!recipe) return null;
  return applyTransformsPreview(rawValue, [{ kind: 'regexExtract', pattern: recipe.pattern, group: recipe.group }]);
}

/**
 * Guesses the `sourceFormat` of a "Convert to date" step from the value picked on
 * the page: the common all-numeric shapes (28.08.2026, 2026-08-28, 28-08-2026,
 * 08/28/2026, 1.9.2026, 20260828). A day/month order that can't be told apart
 * (03/04/2026) defaults to day first and lists the other reading, so the hint can
 * say so. Month names (28 Aug 2026) are not supported by the format at all, and
 * a value with other text around the date gets no guess. Every result is checked
 * against the real preview, so a guess always actually converts the value.
 * @param {string | null | undefined} rawValue
 * @returns {{ format: string, alternatives: string[] } | null}
 */
function inferDateFormat(rawValue) {
  const value = String(rawValue ?? '').trim();
  if (!value) return null;
  /** @type {{ format: string, alternatives: string[] } | null} */
  let guess = null;
  let m;

  if ((m = /^(\d{4})([./-])(\d{1,2})\2(\d{1,2})$/.exec(value))) {
    guess = { format: `{yyyy}${m[2]}{mm}${m[2]}{dd}`, alternatives: [] };
  } else if ((m = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})$/.exec(value))) {
    const first = Number(m[1]);
    const second = Number(m[3]);
    const sep = m[2];
    const dayFirst = `{dd}${sep}{mm}${sep}{yyyy}`;
    const monthFirst = `{mm}${sep}{dd}${sep}{yyyy}`;
    if (first > 12 && second > 12) guess = null;
    else if (first > 12) guess = { format: dayFirst, alternatives: [] };
    else if (second > 12) guess = { format: monthFirst, alternatives: [] };
    else if (first === second || sep === '.') guess = { format: dayFirst, alternatives: [] };
    else guess = { format: dayFirst, alternatives: [monthFirst] };
  } else if (/^\d{8}$/.test(value)) {
    guess = { format: '{yyyy}{mm}{dd}', alternatives: [] };
  }

  if (!guess || toDatePreview(value, guess.format) === null) return null;
  guess.alternatives = guess.alternatives.filter((alt) => toDatePreview(value, alt) !== null);
  return guess;
}

module.exports = { escapeRegexLiteral, RECIPES, buildRecipe, previewRecipe, inferDateFormat };
