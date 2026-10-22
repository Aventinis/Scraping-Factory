// Issue #396: pure logic + storage for the "Advanced" disclosure — a
// <details class="advanced-disclosure" data-advanced="<section id>"> that
// tucks away rarely needed options. Collapsed by default; whether a section
// was opened is remembered per section (never globally — there is no
// "advanced mode") in chrome.storage.local, the same device-preference store
// theme.js and i18n.js use. See advanced-disclosure-ui.js for the DOM side.
const STORAGE_KEY = 'advancedSections';

/**
 * @param {Record<string, boolean> | null | undefined} sections
 * @param {string} id
 */
function isSectionOpen(sections, id) {
  return !!(sections && sections[id] === true);
}

// Closed sections are dropped instead of stored as `false`, so the map only
// ever lists what the user actually opened.
/**
 * @param {Record<string, boolean> | null | undefined} sections
 * @param {string} id
 * @param {boolean} open
 * @returns {Record<string, boolean>}
 */
function withSectionOpen(sections, id, open) {
  const next = { ...(sections || {}) };
  if (open) next[id] = true;
  else delete next[id];
  return next;
}

/** @returns {Promise<Record<string, boolean>>} */
async function loadAdvancedSections() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return {};
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const value = stored[STORAGE_KEY];
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** @param {Record<string, boolean>} sections */
async function persistAdvancedSections(sections) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: sections });
  } catch {
    // Best-effort — a failed write only means the section starts collapsed next time.
  }
}

module.exports = { STORAGE_KEY, isSectionOpen, withSectionOpen, loadAdvancedSections, persistAdvancedSections };

