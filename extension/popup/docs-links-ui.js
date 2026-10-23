// Issue #354 Part B: "Learn more" links that open the bundled documentation
// (see docs-links.js for the key → page table). Markup:
//
//   <a class="learn-more" data-doc="monitoring" href="#" data-i18n="common.learnMore"></a>
//
// or, for DOM built in JS, learnMoreHtml(key). A help popover (#396) gets the
// same link when its host carries `data-doc="<key>"` (see help-popover-ui.js).
// The page opens in a new browser tab from the extension's own origin — no
// network needed, and no external URL anywhere.
const { t, getLanguage } = require('../i18n/i18n');
const { resolveDocTarget } = require('./docs-links');

let wired = false;

// docs/anchors.json (built by extension/docs-build.js) maps the English heading anchors the key
// table uses to the German ones. Read once, only when the panel is German.
/** @type {Promise<object> | null} */
let anchorsPromise = null;
let anchors = null;

function loadAnchors() {
  if (anchorsPromise) return anchorsPromise;
  anchorsPromise = (async () => {
    try {
      if (typeof fetch !== 'function' || typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) return {};
      const response = await fetch(chrome.runtime.getURL('docs/anchors.json'));
      return response.ok ? await response.json() : {};
    } catch {
      return {};
    }
  })().then((loaded) => { anchors = loaded; return loaded; });
  return anchorsPromise;
}

/** The full chrome-extension:// URL of a documentation key, or null. */
function docUrl(key) {
  const target = resolveDocTarget(key, getLanguage(), anchors);
  if (!target) return null;
  return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL
    ? chrome.runtime.getURL(target.file) : target.file;
}

/** Markup of a link, for DOM built in JS. `key` must be a DOC_TARGETS key. */
function learnMoreHtml(key) {
  const label = String(t('common.learnMore')).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<a class="learn-more" data-doc="${key}" href="#">${label}</a>`;
}

/** Gives every `a.learn-more[data-doc]` under `root` its real address (hover, middle click, copy link). */
function initDocsLinks(root = document) {
  // A German panel needs the anchor table to link the German headings; until it has loaded the
  // links point at the English page, then they are updated once.
  if (getLanguage() === 'de' && !anchors) loadAnchors().then(() => initDocsLinks(root));
  root.querySelectorAll('a.learn-more[data-doc]').forEach((el) => {
    const a = /** @type {HTMLAnchorElement} */ (el);
    const url = docUrl(a.dataset.doc || '');
    if (url) a.setAttribute('href', url);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
  });
}

async function openDoc(key) {
  if (getLanguage() === 'de') await loadAnchors();
  const url = docUrl(key);
  if (!url) return;
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) chrome.tabs.create({ url });
  else window.open(url, '_blank', 'noopener');
}

// Delegated on document, so links in re-rendered rows and modals work without
// per-element listeners; wired once.
function wireDocsLinkEvents() {
  if (wired) return;
  wired = true;
  document.addEventListener('click', (e) => {
    const link = /** @type {Element} */ (e.target).closest && /** @type {Element} */ (e.target).closest('a.learn-more[data-doc]');
    if (!link) return;
    e.preventDefault();
    openDoc(/** @type {HTMLElement} */ (link).dataset.doc || '');
  });
}

module.exports = { docUrl, learnMoreHtml, initDocsLinks, openDoc, wireDocsLinkEvents };
