// @ts-check
// Issue #398: pure logic behind the guidance for the first decisions of a
// scrape (mode, container type, field type, engine — UX audit findings 1, 2,
// 11). The "which fits?" texts themselves are #396 help popovers declared in
// the HTML (help.mode.*, help.containerType.*, help.fieldType.*, help.engine.*);
// what lives here is the part that reacts to what actually happened:
//   - after the click that picks a container's element, whether the match
//     count contradicts the type the user chose beforehand (type and element are
//     asked in that order, so the count can't be shown next to the choice),
//   - whether a failed trial run on the Static engine is the "the page builds
//     its content with JavaScript" case (wording of the suggestion is i18n).

/**
 * @typedef {'unknown' | 'zero' | 'singleMany' | 'repeatingOne' | 'ok'} ContainerCountAdvice
 */

/**
 * @param {number | null | undefined} matchCount elements the picked selector matches (null = not computed)
 * @param {boolean | null | undefined} repeating the type chosen in the "new container" modal
 * @returns {ContainerCountAdvice}
 */
function containerCountAdvice(matchCount, repeating) {
  if (typeof matchCount !== 'number') return 'unknown';
  if (matchCount === 0) return 'zero';
  if (repeating === false && matchCount > 1) return 'singleMany';
  if (repeating === true && matchCount === 1) return 'repeatingOne';
  return 'ok';
}

// The one stable sentence the companion's verifier uses when a script ran
// cleanly but wrote nothing (PythonScriptVerifier: "Script ran without errors
// but returned no data …"). Matching the broader error wording belongs to the
// error-message issue (#401); this only recognises that one case.
const NO_DATA_PATTERN = /returned no data/i;

/**
 * True when the Browser engine is worth suggesting: a trial run on the Static
 * engine that came back without data.
 * @param {string | null | undefined} engine
 * @param {string | null | undefined} errorMessage
 */
function shouldSuggestBrowserEngine(engine, errorMessage) {
  return engine === 'Static' && NO_DATA_PATTERN.test(String(errorMessage || ''));
}

module.exports = { containerCountAdvice, shouldSuggestBrowserEngine };
