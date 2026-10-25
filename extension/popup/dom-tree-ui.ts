// ── DOM tree view ────────────────────────────────────────────────────────────
// Extracted from popup.ts (docs/design-notes/extension.md, "Popup module boundaries") — the optional inspector tree showing the live
// page's own DOM structure inside the side panel, used to click-pick a
// selector without needing devtools open. Takes a `bridge` object (same
// convention as api-config-ui.ts/container-tree-ui.js) instead of closing
// over popup.ts's own module-level state.
import type { PopupBridge } from '../types/popup';
import type { DomTreeNode } from '../types/messages';
import { createLogger } from '../shared/logger';
import { setLastError } from './toast';
import { byIdOrNull, TREE_TOGGLE_CHEVRON_SVG } from './dom';

const log = createLogger('SF:Popup');

const DOM_TREE_TIMEOUT_MS = 5000;
let domTreeTimeoutId: ReturnType<typeof setTimeout> | undefined;

// Sends ENABLE_DOM_VIEW and arms a timeout so a lost/slow response shows an
// error instead of spinning forever (see feature/dom-tree-view regression:
// an unthrottled content script could stall the message channel entirely).
export function requestDomTree(bridge: PopupBridge): void {
  clearTimeout(domTreeTimeoutId);
  bridge.patchState({ domTree: null, domTreeTruncated: false, domTreeError: null });
  chrome.runtime.sendMessage({ type: 'ENABLE_DOM_VIEW' });
  domTreeTimeoutId = setTimeout(() => {
    log('DOM_TREE timeout — no response');
    setLastError('DOM tree request timed out', 'DOM tree view');
    bridge.patchState({ domTreeError: 'Tree could not be loaded.' });
  }, DOM_TREE_TIMEOUT_MS);
}

// Called whenever a real DOM_TREE/SELECTION_UNAVAILABLE/ELEMENT_SELECTED
// response arrives (or selection is otherwise cancelled) so the timeout
// fallback above doesn't fire after the fact — domTreeTimeoutId is kept
// module-private here rather than exposed on _state, same encapsulation
// reasoning as any other purely-internal timer handle.
export function cancelPendingDomTreeRequest(): void {
  clearTimeout(domTreeTimeoutId);
}

// Rendered imperatively (not through popup.ts's own render()) so a user's
// expand/collapse clicks survive unrelated state updates (e.g. adding/
// removing a field).
export function formatTreeLabel(node: DomTreeNode): string {
  let label = node.tag;
  if (node.id) label += `#${node.id}`;
  if (node.classes.length) label += `.${node.classes.join('.')}`;
  return label;
}

export function buildTreeNodeEl(node: DomTreeNode, depth: number): HTMLElement {
  const li = document.createElement('li');
  li.className = 'dom-tree-node';
  li.dataset.path = JSON.stringify(node.path);

  const row = document.createElement('div');
  row.className = 'dom-tree-row';
  row.style.paddingLeft = `${depth * 12}px`;

  const hasChildren = node.children.length > 0;
  const toggle = document.createElement('span');
  toggle.className = 'dom-tree-toggle';
  if (hasChildren) toggle.innerHTML = TREE_TOGGLE_CHEVRON_SVG; // unlike the group/API trees, this one starts collapsed (see below)
  toggle.classList.toggle('collapsed', hasChildren); // starts collapsed, unlike the group/api trees
  row.appendChild(toggle);

  const label = document.createElement('span');
  label.textContent = formatTreeLabel(node);
  row.appendChild(label);

  li.appendChild(row);

  if (hasChildren) {
    const childUl = document.createElement('ul');
    childUl.className = 'dom-tree-children hidden';
    node.children.forEach(child => childUl.appendChild(buildTreeNodeEl(child, depth + 1)));
    li.appendChild(childUl);

    toggle.addEventListener('click', () => {
      const collapsed = childUl.classList.toggle('hidden');
      toggle.classList.toggle('collapsed', collapsed);
    });
  }

  return li;
}

export function renderDomTree(tree: DomTreeNode | null | undefined): void {
  const root = byIdOrNull('dom-tree-root');
  if (!root || !tree) return;
  root.innerHTML = '';
  root.appendChild(buildTreeNodeEl(tree, 0));
}

export function findTreeNode(path: number[]): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#dom-tree-root li[data-path='${JSON.stringify(path)}']`);
}

// Un-collapses every ancestor <ul> of `li` so it becomes visible/scrollable-to.
export function expandAncestors(li: HTMLElement): void {
  let ul = li.parentElement;
  while (ul && ul.classList.contains('dom-tree-children')) {
    ul.classList.remove('hidden');
    const ownerLi = ul.parentElement as HTMLElement; // a children list always sits in its node's <li>
    const toggle = (ownerLi.firstElementChild as Element).querySelector('.dom-tree-toggle');
    if (toggle) toggle.classList.remove('collapsed');
    ul = ownerLi.parentElement;
  }
}

let _lastHoverRow: Element | null = null;

export function highlightHover(path: number[]): void {
  if (_lastHoverRow) _lastHoverRow.classList.remove('hover');
  const li = findTreeNode(path);
  const row = li?.firstElementChild ?? null;
  if (li && row) {
    row.classList.add('hover');
    expandAncestors(li);
    li.scrollIntoView?.({ block: 'nearest' });
  }
  _lastHoverRow = row;
}

export function highlightSelected(path: number[]): void {
  document.querySelectorAll('#dom-tree-root .dom-tree-row.selected')
    .forEach(el => el.classList.remove('selected'));
  const li = findTreeNode(path);
  const row = li?.firstElementChild ?? null;
  if (li && row) {
    row.classList.add('selected');
    expandAncestors(li);
    li.scrollIntoView?.({ block: 'nearest' });
  }
}

// Called from popup.ts's render() only while _state.current === STATES.SELECTING
// — the toggle checkbox's own checked state, and the tree wrapper/loading/
// error/truncated visibility, all driven by _state rather than DOM-local
// bookkeeping.
export function renderDomTreeViewState(bridge: PopupBridge): void {
  const state = bridge.getState();
  const toggle = byIdOrNull<HTMLInputElement>('toggle-dom-view');
  if (toggle) toggle.checked = state.domViewEnabled;

  const wrapper = byIdOrNull('dom-tree-wrapper');
  if (wrapper) wrapper.classList.toggle('hidden', !state.domViewEnabled);

  const loading = byIdOrNull('dom-tree-loading');
  if (loading) loading.classList.toggle('hidden', state.domTree !== null || !!state.domTreeError);

  const error = byIdOrNull('dom-tree-error');
  if (error) error.classList.toggle('hidden', !state.domTreeError);

  const truncated = byIdOrNull('dom-tree-truncated');
  if (truncated) truncated.classList.toggle('hidden', !state.domTreeTruncated);
}

export function wireDomTreeViewEvents(bridge: PopupBridge): void {
  byIdOrNull('toggle-dom-view')?.addEventListener('change', (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    log('BTN toggle-dom-view', enabled);
    if (enabled) {
      bridge.patchState({ domViewEnabled: true });
      requestDomTree(bridge);
    } else {
      chrome.runtime.sendMessage({ type: 'DISABLE_DOM_VIEW' });
      cancelPendingDomTreeRequest();
      bridge.patchState({ domViewEnabled: false });
    }
  });
}
