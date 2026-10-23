// @ts-check
// The `:contains("text")` selector suffix: pure helpers (selector-text-filter-ui.js has the field modals' input). The CSS part matches as usual,
// then only elements whose text contains `text` are kept; the matching rule (whole text, whitespace collapsed, case-insensitive) lives in the
// generated scripts' text_selector_* fragments and the content script. This module builds the suffix and parses it back; the syntax is pinned
// across all implementations by test-vectors/text-selector.json. Suggested texts are kept short so the selector shown in the field list stays
// readable (the match is a substring anyway).
const SUGGESTED_TEXT_MAX_LENGTH = 60;

const TEXT_FILTER_PATTERN = /:contains\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*\)\s*$/i;

/**
 * @param {string} text
 * @returns {string} the text with backslashes and double quotes escaped for use inside "..."
 */
function escapeFilterText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Whitespace collapsed and trimmed — exactly the form the matcher compares
 * against, so what the user sees in the selector is what gets matched.
 * @param {string | null | undefined} text
 */
function collapseWhitespace(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * `selector` with `:contains("text")` appended, or `selector` unchanged when
 * the text is blank (so an empty input keeps the pick's selector as it was).
 * @param {string} selector
 * @param {string | null | undefined} text
 */
function appendTextFilter(selector, text) {
  const wanted = collapseWhitespace(text);
  return wanted ? `${selector}:contains("${escapeFilterText(wanted)}")` : selector;
}

/**
 * @param {string} selector
 * @returns {{ base: string, text: string | null }}
 */
function splitTextFilter(selector) {
  const match = TEXT_FILTER_PATTERN.exec(selector);
  if (!match) return { base: selector, text: null };
  const text = match[1] !== undefined ? match[1] : match[2];
  return { base: selector.slice(0, match.index).trimEnd() || '*', text: text.replace(/\\(.)/g, '$1') };
}

/**
 * A starting point for the text input: the clicked element's own text,
 * collapsed and shortened. Empty when the element has no text of its own.
 * @param {string | null | undefined} rawText
 */
function suggestFilterText(rawText) {
  return collapseWhitespace(rawText).slice(0, SUGGESTED_TEXT_MAX_LENGTH).trimEnd();
}

module.exports = { SUGGESTED_TEXT_MAX_LENGTH, escapeFilterText, collapseWhitespace, appendTextFilter, splitTextFilter, suggestFilterText };

