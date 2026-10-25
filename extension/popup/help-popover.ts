// The reusable help popover's pure logic (help-popover-ui.ts renders it): a "?" button toggles a short offline explanation with an
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

export const HELP_KEY_PATTERN = /^help\.[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/;

// Soft limits: a help text longer than this has outgrown a popover in a 280 px side panel (shorten it or move it to docs/user/).
export const HELP_TEXT_MAX_CHARS = 320;
export const HELP_EXAMPLE_MAX_CHARS = 120;

export interface HelpEntry { text: string; example: string | null }

export function isValidHelpKey(key: unknown): boolean {
  return typeof key === 'string' && HELP_KEY_PATTERN.test(key);
}

/** Reads one entry through `t`, which resolves a missing key to the key itself (see i18n.ts). Null when the text is missing. */
export function getHelpEntry(t: (key: string) => string, key: string): HelpEntry | null {
  const textKey = `${key}.text`;
  const text = t(textKey);
  if (!text || text === textKey) return null;
  const exampleKey = `${key}.example`;
  const example = t(exampleKey);
  return { text, example: example && example !== exampleKey ? example : null };
}

/** Every `data-help="…"` key referenced in a piece of HTML, de-duplicated, in order of first appearance. */
export function collectHelpKeysFromHtml(html: string): string[] {
  const keys: string[] = [];
  for (const match of html.matchAll(/data-help="([^"]*)"/g)) {
    if (!keys.includes(match[1])) keys.push(match[1]);
  }
  return keys;
}

/**
 * Flattens a dictionary's `help` subtree into `{ 'help.area.field': entry }`. An object that is not `{ text, example? }`-shaped is
 * still listed (with whatever it holds) so the validator can name it.
 */
export function collectHelpEntries(dictionary: unknown): Record<string, unknown> {
  const entries: Record<string, unknown> = {};
  const help = (dictionary as { help?: unknown } | null | undefined)?.help;
  if (!help || typeof help !== 'object') return entries;
  for (const [area, fields] of Object.entries(help)) {
    if (!fields || typeof fields !== 'object') { entries[`help.${area}`] = fields; continue; }
    for (const [field, entry] of Object.entries(fields)) entries[`help.${area}.${field}`] = entry;
  }
  return entries;
}

/** Structural problems of one entry (empty = fine). Length is reported separately: it is a soft limit. */
export function helpEntryProblems(key: string, entry: unknown): string[] {
  const problems: string[] = [];
  if (!isValidHelpKey(key)) problems.push(`${key}: key must look like help.<area>.<field>`);
  if (!entry || typeof entry !== 'object') {
    problems.push(`${key}: must be an object with a "text" string`);
    return problems;
  }
  const fields = entry as Record<string, unknown>;
  if (typeof fields.text !== 'string' || !fields.text.trim()) problems.push(`${key}: missing "text"`);
  if ('example' in fields && (typeof fields.example !== 'string' || !fields.example.trim())) {
    problems.push(`${key}: "example" must be a non-empty string when present`);
  }
  for (const extra of Object.keys(fields)) {
    if (extra !== 'text' && extra !== 'example') problems.push(`${key}: unexpected property "${extra}"`);
  }
  return problems;
}

export function helpEntryLengthWarnings(key: string, entry: unknown): string[] {
  const warnings: string[] = [];
  const fields = entry as { text?: unknown; example?: unknown } | null | undefined;
  if (fields && typeof fields.text === 'string' && fields.text.length > HELP_TEXT_MAX_CHARS) {
    warnings.push(`${key}: text is ${fields.text.length} characters (limit ${HELP_TEXT_MAX_CHARS}) — shorten it or move the detail to docs/user/`);
  }
  if (fields && typeof fields.example === 'string' && fields.example.length > HELP_EXAMPLE_MAX_CHARS) {
    warnings.push(`${key}: example is ${fields.example.length} characters (limit ${HELP_EXAMPLE_MAX_CHARS})`);
  }
  return warnings;
}

/** One popover open at a time: asking for the open one closes it, asking for another switches. Returns the id open afterwards. */
export function nextOpenHelpId(openId: string | null, requestedId: string): string | null {
  return openId === requestedId ? null : requestedId;
}

/** Markup for a help host, for DOM that is built in JS instead of declared in HTML; `docKey` adds a "Learn more" link (docs-links.ts). */
export function helpHostHtml(key: string, docKey?: string): string {
  const doc = docKey ? ` data-doc="${String(docKey).replace(/"/g, '&quot;')}"` : '';
  return `<span class="help-host" data-help="${String(key).replace(/"/g, '&quot;')}"${doc}></span>`;
}
