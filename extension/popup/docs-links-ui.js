// Issue #354 Part B: "Learn more" links that open the bundled documentation
// (see docs-links.js for the key → page table). Markup:
//
//   <a class="learn-more" data-doc="monitoring" href="#" data-i18n="common.learnMore"></a>
//
// or, for DOM built in JS, learnMoreHtml(key). A help popover (#396) gets the
// same link when its host carries `data-doc="<key>"` (see help-popover-ui.js).
// The page opens in a new browser tab from the extension's own origin — no
// network needed, and no external URL anywhere.
const { t } = require('../i18n/i18n');
const { resolveDocTarget } = require('./docs-links');

let wired = false;

/** The full chrome-extension:// URL of a documentation key, or null. */
function docUrl(key) {
  const target = resolveDocTarget(key);
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
  root.querySelectorAll('a.learn-more[data-doc]').forEach((el) => {
    const a = /** @type {HTMLAnchorElement} */ (el);
    const url = docUrl(a.dataset.doc || '');
    if (url) a.setAttribute('href', url);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
  });
}

function openDoc(key) {
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
