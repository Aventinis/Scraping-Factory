// @ts-check
// Issue #398: pure logic behind the guidance for the first decisions of a
// scrape (mode, container type, field type, engine — UX audit findings 1, 2,
// 11). The "which fits?" texts themselves are #396 help popovers declared in
// the HTML (help.mode.*, help.containerType.*, help.fieldType.*, help.engine.*);
// what lives here is the part that reacts to what actually happened:
//   - after the click that picks a container's element, whether the match
//     count contradicts the type the user chose beforehand (type and element are
//     asked in that order, so the count can't be shown next to the choice).
// (The "try the Browser engine" suggestion after an empty Static trial run lives
// in error-messages.js — the plain-language "no data" hint, Issue #401.)

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

module.exports = { containerCountAdvice };
