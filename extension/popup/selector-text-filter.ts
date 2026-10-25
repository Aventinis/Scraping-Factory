// The `:contains("text")` selector suffix: pure helpers (selector-text-filter-ui.ts has the field modals' input). The CSS part
// matches as usual, then only elements whose text contains `text` are kept; the matching rule (whole text, whitespace collapsed,
// case-insensitive) lives in the generated scripts' text_selector_* fragments and the content script. This module builds the
// suffix and parses it back; the syntax is pinned across all implementations by test-vectors/text-selector.json.

// Suggested texts stay short so the selector shown in the field list is readable (the match is a substring anyway).
export const SUGGESTED_TEXT_MAX_LENGTH = 60;

const TEXT_FILTER_PATTERN = /:contains\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*\)\s*$/i;

/** Escapes backslashes and double quotes for use inside "...". */
export function escapeFilterText(text: string): string {
  return String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Whitespace collapsed and trimmed: exactly the form the matcher compares against. */
export function collapseWhitespace(text: string | null | undefined): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/** `selector` with `:contains("text")` appended, or unchanged when the text is blank. */
export function appendTextFilter(selector: string, text: string | null | undefined): string {
  const wanted = collapseWhitespace(text);
  return wanted ? `${selector}:contains("${escapeFilterText(wanted)}")` : selector;
}

export function splitTextFilter(selector: string): { base: string; text: string | null } {
  const match = TEXT_FILTER_PATTERN.exec(selector);
  if (!match) return { base: selector, text: null };
  const text = match[1] !== undefined ? match[1] : match[2];
  return { base: selector.slice(0, match.index).trimEnd() || '*', text: text.replace(/\\(.)/g, '$1') };
}

/** A starting point for the text input: the clicked element's own text, collapsed and shortened (empty without text). */
export function suggestFilterText(rawText: string | null | undefined): string {
  return collapseWhitespace(rawText).slice(0, SUGGESTED_TEXT_MAX_LENGTH).trimEnd();
}
