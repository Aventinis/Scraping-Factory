// @ts-check
// The reusable help popover's pure logic (help-popover-ui.js renders it): a "?" button toggles a short offline explanation with an
// optional example. A screen declares one in HTML only,
//
//   <span class="help-host" data-help="help.requestHeaders.headers"></span>
//
// and the dictionaries (i18n/de|en|es.json) carry the text:
//
//   "help": { "requestHeaders": { "headers": { "text": "…", "example": "…" } } }
//
// Conventions (help-i18n.test.js enforces what a machine can): key `help.<area>.<field>` in camelCase; `.text` is required, at most
// 2–3 short sentences saying what the option is and what to know before touching it (longer explanations go to docs/user/); a "\n"
// starts a new line; `.example` is optional, one line as it would be typed; nothing else under an entry; every key exists in de, en
// and es.
const HELP_KEY_PATTERN = /^help\.[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/;

// Soft limits — a help text longer than this has outgrown a popover in a
// 280 px side panel and should be shortened (or moved to docs/user/).
const HELP_TEXT_MAX_CHARS = 320;
const HELP_EXAMPLE_MAX_CHARS = 120;

/** @param {any} key */
function isValidHelpKey(key) {
  return typeof key === 'string' && HELP_KEY_PATTERN.test(key);
}

/**
 * Reads one entry through `t` (which resolves a missing key to the key
 * itself, see i18n.js). Returns null when the text is missing.
 * @param {(key: string) => string} t
 * @param {string} key
 * @returns {{ text: string, example: string | null } | null}
 */
function getHelpEntry(t, key) {
  const textKey = `${key}.text`;
  const text = t(textKey);
  if (!text || text === textKey) return null;
  const exampleKey = `${key}.example`;
  const example = t(exampleKey);
  return { text, example: example && example !== exampleKey ? example : null };
}

/**
 * Every `data-help="…"` key referenced in a piece of HTML, de-duplicated,
 * in order of first appearance.
 * @param {string} html
 * @returns {string[]}
 */
function collectHelpKeysFromHtml(html) {
  /** @type {string[]} */
  const keys = [];
  for (const match of html.matchAll(/data-help="([^"]*)"/g)) {
    if (!keys.includes(match[1])) keys.push(match[1]);
  }
  return keys;
}

/**
 * Flattens a dictionary's `help` subtree into `{ 'help.area.field': entry }`.
 * An object that is not `{ text, example? }`-shaped is still listed (with
 * whatever it holds) so the validator can name it.
 * @param {any} dictionary
 * @returns {Record<string, any>}
 */
function collectHelpEntries(dictionary) {
  /** @type {Record<string, any>} */
  const entries = {};
  const help = dictionary && dictionary.help;
  if (!help || typeof help !== 'object') return entries;
  for (const [area, fields] of Object.entries(help)) {
    if (!fields || typeof fields !== 'object') { entries[`help.${area}`] = fields; continue; }
    for (const [field, entry] of Object.entries(fields)) entries[`help.${area}.${field}`] = entry;
  }
  return entries;
}

/**
 * Structural problems of one entry (empty = fine). Length is reported
 * separately by helpEntryLengthWarnings, since it is a soft limit.
 * @param {string} key
 * @param {any} entry
 * @returns {string[]}
 */
function helpEntryProblems(key, entry) {
  const problems = [];
  if (!isValidHelpKey(key)) problems.push(`${key}: key must look like help.<area>.<field>`);
  if (!entry || typeof entry !== 'object') {
    problems.push(`${key}: must be an object with a "text" string`);
    return problems;
  }
  if (typeof entry.text !== 'string' || !entry.text.trim()) problems.push(`${key}: missing "text"`);
  if ('example' in entry && (typeof entry.example !== 'string' || !entry.example.trim())) {
    problems.push(`${key}: "example" must be a non-empty string when present`);
  }
  for (const extra of Object.keys(entry)) {
    if (extra !== 'text' && extra !== 'example') problems.push(`${key}: unexpected property "${extra}"`);
  }
  return problems;
}

/**
 * @param {string} key
 * @param {any} entry
 * @returns {string[]}
 */
function helpEntryLengthWarnings(key, entry) {
  const warnings = [];
  if (entry && typeof entry.text === 'string' && entry.text.length > HELP_TEXT_MAX_CHARS) {
    warnings.push(`${key}: text is ${entry.text.length} characters (limit ${HELP_TEXT_MAX_CHARS}) — shorten it or move the detail to docs/user/`);
  }
  if (entry && typeof entry.example === 'string' && entry.example.length > HELP_EXAMPLE_MAX_CHARS) {
    warnings.push(`${key}: example is ${entry.example.length} characters (limit ${HELP_EXAMPLE_MAX_CHARS})`);
  }
  return warnings;
}

/**
 * One popover open at a time: asking for the one already open closes it,
 * asking for another switches to it.
 * @param {string | null} openId
 * @param {string} requestedId
 * @returns {string | null} the id that should be open afterwards
 */
function nextOpenHelpId(openId, requestedId) {
  return openId === requestedId ? null : requestedId;
}

/**
 * Markup for a help host, for DOM that is built in JS instead of declared in HTML.
 * @param {string} key
 */
/**
 * @param {string} key help key
 * @param {string} [docKey] optional "Learn more" key (docs-links.ts)
 */
function helpHostHtml(key, docKey) {
  const doc = docKey ? ` data-doc="${String(docKey).replace(/"/g, '&quot;')}"` : '';
  return `<span class="help-host" data-help="${String(key).replace(/"/g, '&quot;')}"${doc}></span>`;
}

module.exports = {
  HELP_KEY_PATTERN, HELP_TEXT_MAX_CHARS, HELP_EXAMPLE_MAX_CHARS,
  isValidHelpKey, getHelpEntry, collectHelpKeysFromHtml, collectHelpEntries,
  helpEntryProblems, helpEntryLengthWarnings, nextOpenHelpId, helpHostHtml,
};

