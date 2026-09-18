// ── DOM tree view ────────────────────────────────────────────────────────────
// Extracted from popup.js (see CLAUDE.md's "Popup module boundaries"
// architecture decision) — the optional inspector tree showing the live
// page's own DOM structure inside the side panel, used to click-pick a
// selector without needing devtools open. Takes a `bridge` object (same
// convention as api-config-ui.js/container-tree-ui.js) instead of closing
// over popup.js's own module-level state.
const SFDomTreeUI = (function() {
const { createLogger } =
  typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
const log = createLogger('SF:Popup');

const { setLastError } =
  typeof require !== 'undefined' ? require('./toast') : self.SFToast;

const DOM_TREE_TIMEOUT_MS = 5000;
let domTreeTimeoutId = null;

// Sends ENABLE_DOM_VIEW and arms a timeout so a lost/slow response shows an
// error instead of spinning forever (see feature/dom-tree-view regression:
// an unthrottled content script could stall the message channel entirely).
function requestDomTree(bridge) {
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
function cancelPendingDomTreeRequest() {
  clearTimeout(domTreeTimeoutId);
}

// Rendered imperatively (not through popup.js's own render()) so a user's
// expand/collapse clicks survive unrelated state updates (e.g. adding/
// removing a field).
// Issue #139: one static inline chevron per row instead of swapping between
// two different Unicode glyphs (▸/▾) on click — see container-tree-ui.js's
// own copy of this constant for the full rationale. Unlike the group/api
// trees, this one starts *collapsed* (see buildTreeNodeEl/expandAncestors
// below), so the .collapsed class is applied at build time here too.
const TREE_TOGGLE_CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polyline points="6 9 12 15 18 9"></polyline></svg>';

function formatTreeLabel(node) {
  let label = node.tag;
  if (node.id) label += `#${node.id}`;
  if (node.classes.length) label += `.${node.classes.join('.')}`;
  return label;
}

function buildTreeNodeEl(node, depth) {
  const li = document.createElement('li');
  li.className = 'dom-tree-node';
  li.dataset.path = JSON.stringify(node.path);

  const row = document.createElement('div');
  row.className = 'dom-tree-row';
  row.style.paddingLeft = `${depth * 12}px`;

  const hasChildren = node.children.length > 0;
  const toggle = document.createElement('span');
  toggle.className = 'dom-tree-toggle';
  if (hasChildren) toggle.innerHTML = TREE_TOGGLE_CHEVRON_SVG;
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

function renderDomTree(tree) {
  const root = document.getElementById('dom-tree-root');
  if (!root || !tree) return;
  root.innerHTML = '';
  root.appendChild(buildTreeNodeEl(tree, 0));
}

function findTreeNode(path) {
  return document.querySelector(`#dom-tree-root li[data-path='${JSON.stringify(path)}']`);
}

// Un-collapses every ancestor <ul> of `li` so it becomes visible/scrollable-to.
function expandAncestors(li) {
  let ul = li.parentElement;
  while (ul && ul.classList.contains('dom-tree-children')) {
    ul.classList.remove('hidden');
    const ownerLi = ul.parentElement;
    const toggle = ownerLi.firstElementChild.querySelector('.dom-tree-toggle');
    if (toggle) toggle.classList.remove('collapsed');
    ul = ownerLi.parentElement;
  }
}

let _lastHoverRow = null;

function highlightHover(path) {
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

function highlightSelected(path) {
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

// Called from popup.js's render() only while _state.current === STATES.SELECTING
// — the toggle checkbox's own checked state, and the tree wrapper/loading/
// error/truncated visibility, all driven by _state rather than DOM-local
// bookkeeping.
function renderDomTreeViewState(bridge) {
  const state = bridge.getState();
  const toggle = document.getElementById('toggle-dom-view');
  if (toggle) toggle.checked = state.domViewEnabled;

  const wrapper = document.getElementById('dom-tree-wrapper');
  if (wrapper) wrapper.classList.toggle('hidden', !state.domViewEnabled);

  const loading = document.getElementById('dom-tree-loading');
  if (loading) loading.classList.toggle('hidden', state.domTree !== null || !!state.domTreeError);

  const error = document.getElementById('dom-tree-error');
  if (error) error.classList.toggle('hidden', !state.domTreeError);

  const truncated = document.getElementById('dom-tree-truncated');
  if (truncated) truncated.classList.toggle('hidden', !state.domTreeTruncated);
}

function wireDomTreeViewEvents(bridge) {
  document.getElementById('toggle-dom-view')?.addEventListener('change', (e) => {
    const enabled = e.target.checked;
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

  return {requestDomTree, cancelPendingDomTreeRequest,
    formatTreeLabel, buildTreeNodeEl, renderDomTree, findTreeNode, expandAncestors,
    highlightHover, highlightSelected,
    renderDomTreeViewState, wireDomTreeViewEvents,};
})();

if (typeof module !== 'undefined') module.exports = SFDomTreeUI;
if (typeof self !== 'undefined') self.SFDomTreeUI = SFDomTreeUI;
