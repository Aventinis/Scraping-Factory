// Issue #233: hovering a row in the flat fields list or the container tree
// highlights that one row's element(s) on the live page — the reverse
// direction of the DOM inspector's own HOVER_ELEMENT (page → tree row), and
// a single-row counterpart to the full "Vorschau" (preview.js), which always
// highlights every configured element at once. Needs no toggle: it's purely
// a hover affordance, active whenever the list is visible.
//
// The pure builders below turn a flat field / a container tree path into the
// HOVER_HIGHLIGHT payload content-script.js's matchHoverHighlight resolves:
// the selector chain from the root down to the hovered row, each step
// flagged `all` exactly the way matchGroupTree treats it (a repeating group
// or a flat field keeps every match, a non-repeating group or a container
// field only the first per scope). wireHoverHighlight attaches the delegated
// mouse listeners; it needs no popup state of its own, so (unlike most
// popup modules) it takes no `bridge` — callers pass a resolver instead.
const SFHoverHighlight = (function () {
  const { createLogger } = typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
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

  // Walks `groups` along `path` (the same index path container-tree-ui.js
  // stamps onto each row's <li data-path>). The framePath is the nearest one
  // set on the chain, hovered node first — a node picked inside an iframe
  // carries its own, and its descendants were picked within the same frame.
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

  // Delegated on the list container (rows are re-rendered on every state
  // change, so per-row listeners would need re-attaching each time).
  // `rowSelector` identifies a row element; `resolvePayload(rowEl)` returns
  // the HOVER_HIGHLIGHT payload for it, or null. Moving within one row sends
  // nothing new (`currentRow` dedupes); moving onto a gap between rows,
  // leaving the list, or clicking (a click may remove/re-render the hovered
  // row, after which no mouseleave would ever fire for it) clears the
  // highlight.
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

  return { buildFlatFieldHighlight, buildGroupNodeHighlight, wireHoverHighlight };
})();

if (typeof module !== 'undefined') module.exports = SFHoverHighlight;
if (typeof self !== 'undefined') self.SFHoverHighlight = SFHoverHighlight;
