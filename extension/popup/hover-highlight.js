// Hovering a row in the flat fields list or container tree highlights that row's element(s) on the live page: the reverse of the DOM inspector's
// HOVER_ELEMENT, and a single-row counterpart to the full "Show preview" (preview.js). No toggle: active whenever the list is visible.
//
// The pure builders turn a flat field / a container path into the HOVER_HIGHLIGHT payload that content-script.js's matchHoverHighlight resolves:
// the selector chain from the root to the row, each step flagged `all` as matchGroupTree treats it (repeating group or flat field: every match;
// non-repeating group or container field: the first per scope). wireHoverHighlight attaches the delegated listeners; it needs no popup state,
// so unlike most popup modules it takes no `bridge`, callers pass a resolver.
const { createLogger } = require('../shared/logger');
const log = createLogger('SF:HoverHighlight');

// null for a row with nothing to highlight — a combine/split-derived field
// has no selector of its own (Issue #206 follow-up).
/**
 * @param {{name: string, selector?: string | null, framePath?: string[] | null} | null | undefined} field
 * @returns {{name: string, steps: Array<{selector: string, all: boolean}>, framePath: string[] | null} | null}
 */
function buildFlatFieldHighlight(field) {
  if (!field || !field.selector) return null;
  return { name: field.name, steps: [{ selector: field.selector, all: true }], framePath: field.framePath || null };
}

// Walks `groups` along `path` (the index path container-tree-ui.js stamps on each row's <li data-path>). The framePath is the nearest one on
// the chain, hovered node first: a node picked inside an iframe carries its own, and its descendants were picked in the same frame.
/**
 * @param {Array<*>} groups
 * @param {number[]} path
 * @returns {{name: string, steps: Array<{selector: string, all: boolean}>, framePath: string[] | null} | null}
 */
function buildGroupNodeHighlight(groups, path) {
  const chain = [];
  let siblings = groups;
  for (const index of path || []) {
    const node = siblings?.[index];
    if (!node) return null;
    chain.push(node);
    siblings = node.children;
  }
  if (chain.length === 0 || chain.some(node => !node.selector)) return null;
  const hovered = chain[chain.length - 1];
  const framePath = [...chain].reverse().find(node => node.framePath && node.framePath.length > 0)?.framePath || null;
  return {
    name: hovered.name,
    steps: chain.map(node => ({ selector: node.selector, all: node.kind === 'group' ? !!node.repeating : false })),
    framePath,
  };
}

function sendHighlight(payload) {
  try {
    chrome.runtime.sendMessage({ type: 'HOVER_HIGHLIGHT', ...payload });
  } catch (err) {
    log('HOVER_HIGHLIGHT send failed', err.message);
  }
}

function sendClear() {
  try {
    chrome.runtime.sendMessage({ type: 'HOVER_HIGHLIGHT_CLEAR' });
  } catch (err) {
    log('HOVER_HIGHLIGHT_CLEAR send failed', err.message);
  }
}

// Delegated on the list container (rows are re-rendered on every state change). `rowSelector` identifies a row, `resolvePayload(rowEl)` returns
// its payload or null. Moving within a row sends nothing (`currentRow` dedupes); a gap, leaving the list, or a click (which may re-render the row,
// so no mouseleave would fire) clears the highlight.
/**
 * @param {HTMLElement | null} listEl
 * @param {string} rowSelector
 * @param {(rowEl: HTMLElement) => * | null} resolvePayload
 */
function wireHoverHighlight(listEl, rowSelector, resolvePayload) {
  if (!listEl) return;
  let currentRow = null;
  let highlightActive = false;

  const clear = () => {
    currentRow = null;
    if (!highlightActive) return;
    highlightActive = false;
    sendClear();
  };

  listEl.addEventListener('mouseover', (e) => {
    const row = /** @type {HTMLElement} */ (e.target).closest?.(rowSelector);
    if (!row || !listEl.contains(row)) { clear(); return; }
    if (row === currentRow) return;
    currentRow = row;
    const payload = resolvePayload(/** @type {HTMLElement} */ (row));
    if (payload) {
      highlightActive = true;
      sendHighlight(payload);
    } else if (highlightActive) {
      highlightActive = false;
      sendClear();
    }
  });
  listEl.addEventListener('mouseleave', clear);
  listEl.addEventListener('click', clear);
}

module.exports = { buildFlatFieldHighlight, buildGroupNodeHighlight, wireHoverHighlight };

