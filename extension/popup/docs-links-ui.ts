// Issue #354 Part B: "Learn more" links that open the bundled documentation
// (see docs-links.ts for the key → page table). Markup:
//
//   <a class="learn-more" data-doc="monitoring" href="#" data-i18n="common.learnMore"></a>
//
// or, for DOM built in JS, learnMoreHtml(key). A help popover (#396) gets the
// same link when its host carries `data-doc="<key>"` (see help-popover-ui.ts).
// The page opens in a new browser tab from the extension's own origin — no
// network needed, and no external URL anywhere.
import { t, getLanguage } from '../i18n/i18n';
import { resolveDocTarget } from './docs-links';
import type { DocAnchors } from './docs-links';
import { qsa } from './dom';

let wired = false;

// docs/anchors.json (built by extension/docs-build.js) maps the English heading anchors the key
// table uses to the German ones. Read once, only when the panel is German.
let anchorsPromise: Promise<DocAnchors> | null = null;
let anchors: DocAnchors | null = null;

function loadAnchors(): Promise<DocAnchors> {
  if (anchorsPromise) return anchorsPromise;
  anchorsPromise = (async () => {
    try {
      if (typeof fetch !== 'function' || typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) return {};
      const response = await fetch(chrome.runtime.getURL('docs/anchors.json'));
      return response.ok ? await response.json() as DocAnchors : {}; // docs/anchors.json, built by docs-build.js
    } catch {
      return {};
    }
  })().then((loaded) => { anchors = loaded; return loaded; });
  return anchorsPromise;
}

/** The full chrome-extension:// URL of a documentation key, or null. */
export function docUrl(key: string): string | null {
  const target = resolveDocTarget(key, getLanguage(), anchors);
  if (!target) return null;
  return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL
    ? chrome.runtime.getURL(target.file) : target.file;
}

/** Markup of a link, for DOM built in JS. `key` must be a DOC_TARGETS key. */
export function learnMoreHtml(key: string): string {
  const label = String(t('common.learnMore')).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<a class="learn-more" data-doc="${key}" href="#">${label}</a>`;
}

/** Gives every `a.learn-more[data-doc]` under `root` its real address (hover, middle click, copy link). */
export function initDocsLinks(root: ParentNode = document): void {
  // A German panel needs the anchor table to link the German headings; until it has loaded the
  // links point at the English page, then they are updated once.
  if (getLanguage() === 'de' && !anchors) loadAnchors().then(() => initDocsLinks(root));
  qsa<HTMLAnchorElement>('a.learn-more[data-doc]', root).forEach((a) => {
    const url = docUrl(a.dataset.doc || '');
    if (url) a.setAttribute('href', url);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
  });
}

export async function openDoc(key: string): Promise<void> {
  if (getLanguage() === 'de') await loadAnchors();
  const url = docUrl(key);
  if (!url) return;
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) chrome.tabs.create({ url });
  else window.open(url, '_blank', 'noopener');
}

// Delegated on document, so links in re-rendered rows and modals work without
// per-element listeners; wired once.
export function wireDocsLinkEvents(): void {
  if (wired) return;
  wired = true;
  document.addEventListener('click', (e) => {
    const target = e.target as Element;
    const link = target.closest && target.closest<HTMLElement>('a.learn-more[data-doc]');
    if (!link) return;
    e.preventDefault();
    openDoc(link.dataset.doc || '');
  });
}
