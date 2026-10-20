// @ts-check
// The `:contains("text")` selector suffix (Issue #227) — pure helpers, no DOM
// (see selector-text-filter-ui.js for the field modals' text input). A
// selector may end in :contains("text"): the CSS part in front of it matches
// as usual, then only the elements whose text contains `text` are kept. The
// matching rule (whole text, whitespace collapsed, case-insensitive) lives in
// the generated scripts' text_selector_* fragments and the content script;
// this module only *builds* the suffix and parses it back for display/tests.
// The companion's SelectorTextFilter.cs and the content script's
// splitTextFilter hold the other copies of the syntax — selector-text-
// filter.test.js, SelectorTextFilterTests.cs and content-script.test.js run
// the same cases.
const SFSelectorTextFilter = (function () {
  // Long enough to be distinctive, short enough that the selector (shown in
  // the field list) stays readable — the match is a substring anyway, so a
  // cut-off start of a long label still finds it.
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

  return { SUGGESTED_TEXT_MAX_LENGTH, escapeFilterText, collapseWhitespace, appendTextFilter, splitTextFilter, suggestFilterText };
})();

if (typeof module !== 'undefined') module.exports = SFSelectorTextFilter;
if (typeof self !== 'undefined') self.SFSelectorTextFilter = SFSelectorTextFilter;
