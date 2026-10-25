// Typed DOM lookups and the shared HTML escaper for the popup's UI modules. A lookup asserts the element type once, here, so a caller
// asks for `byId<HTMLInputElement>('x')` instead of casting `document.getElementById('x')` at every call site.
//
// Most popup code tolerates a missing element (a unit-test fixture builds only part of the DOM, a screen partial may not be loaded),
// so `byIdOrNull` is the usual choice; `byId` is for an element the code cannot work without.

export function byIdOrNull<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = byIdOrNull<T>(id);
  if (!element) throw new Error(`Element #${id} is missing from the popup markup`);
  return element;
}

// Reads a tree row's `data-path` (the JSON array of child indices that buildGroupTreeNodeEl and its siblings write) back as a path.
export function parseDataPath(element: HTMLElement): number[] {
  return JSON.parse(element.dataset.path as string);
}

export function qsOrNull<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function qs<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = qsOrNull<T>(selector, root);
  if (!element) throw new Error(`No element matches "${selector}"`);
  return element;
}

export function qsa<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

// Escapes text for HTML content and double- or single-quoted attributes; null/undefined become ''.
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The chevron of the three tree views (container, API response, DOM inspector): one static inline SVG per row; collapsed/expanded
// is a CSS rotation driven by the .collapsed class (popup.html's shared .group-tree-toggle svg rule), so no glyph is swapped on click.
export const TREE_TOGGLE_CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polyline points="6 9 12 15 18 9"></polyline></svg>';
