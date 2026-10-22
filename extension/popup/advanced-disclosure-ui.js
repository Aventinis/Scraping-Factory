// Issue #396: DOM side of the "Advanced" disclosure (logic and storage in
// advanced-disclosure.js). Declared in HTML as
//
//   <details class="advanced-disclosure" data-advanced="request-headers">
//     <summary data-i18n="common.advanced"></summary>
//     … the rarely needed options …
//   </details>
//
// or built in JS with createAdvancedDisclosure(). initAdvancedDisclosures()
// applies each section's remembered open state once the markup is in the DOM;
// the `toggle` listener (capture phase — `toggle` does not bubble) then
// remembers every later change.
const { isSectionOpen, withSectionOpen, loadAdvancedSections, persistAdvancedSections } =
  require('./advanced-disclosure');
const { t } = require('../i18n/i18n');

let sections = {};
let wired = false;

/**
 * Builds the disclosure element; the caller appends the rare options to
 * `.advanced-disclosure-body`.
 * @param {string} id stable per-section id (the storage key)
 * @param {string} [summaryKey] i18n key of the summary line
 */
function createAdvancedDisclosure(id, summaryKey = 'common.advanced') {
  const details = document.createElement('details');
  details.className = 'advanced-disclosure';
  details.dataset.advanced = id;
  // Remembered state applies at once (sections are loaded at init): a
  // disclosure built by a re-render must not collapse and reopen.
  details.open = isSectionOpen(sections, id);
  const summary = document.createElement('summary');
  summary.dataset.i18n = summaryKey;
  summary.textContent = t(summaryKey);
  const body = document.createElement('div');
  body.className = 'advanced-disclosure-body';
  details.append(summary, body);
  return details;
}

/** Applies the remembered open state to every disclosure under `root`. */
async function initAdvancedDisclosures(root = document) {
  sections = await loadAdvancedSections();
  root.querySelectorAll('details[data-advanced]').forEach((el) => {
    const details = /** @type {HTMLDetailsElement} */ (el);
    details.open = isSectionOpen(sections, details.dataset.advanced || '');
  });
}

function wireAdvancedDisclosureEvents() {
  if (wired) return;
  wired = true;
  document.addEventListener('toggle', (e) => {
    const details = /** @type {HTMLDetailsElement} */ (e.target);
    const id = details && details.dataset && details.dataset.advanced;
    if (!id || !(details.matches && details.matches('details'))) return;
    // Setting `open` programmatically in init fires `toggle` too — only
    // persist a real change.
    if (isSectionOpen(sections, id) === details.open) return;
    sections = withSectionOpen(sections, id, details.open);
    persistAdvancedSections(sections);
  }, true);
}

module.exports = { createAdvancedDisclosure, initAdvancedDisclosures, wireAdvancedDisclosureEvents };

