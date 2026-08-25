// Exported for testing (Jest/jsdom). In the extension build the chrome API
// calls are guarded by the message listener below.

const { createLogger, getLogBuffer } =
  typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
const log = createLogger('SF:Content');

// Surfaces otherwise-silent script errors in the bug report (see GET_LOGS
// below) instead of only showing up in the page's own devtools console.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => log('UNCAUGHT_ERROR', e.message));
  window.addEventListener('unhandledrejection', (e) => log('UNHANDLED_REJECTION', String(e.reason)));
}

// scopeRoot (optional): stops the upward walk there instead of document.body,
// so the selector is valid relative to a container instance rather than the
// whole page — used when adding a nested container/field in Container-Mode
// (see startSelection's scopeSelector).
//
// avoidId (optional): skips the ID short-circuit below. An id is unique
// page-wide, so a selector built from one can only ever match a single
// element — fine for a one-off flat field or an "Einzelnes Element"
// container, but self-defeating for anything that has to match N times: a
// "Wiederholend" container's own selector, or any container/field nested
// inside one (its selector gets re-evaluated once per repeating instance —
// see popup.js's hasRepeatingAncestor).
function buildSelector(element, scopeRoot, avoidId) {
  const boundary = scopeRoot || document.body;
  const segments = [];

  let current = element;
  while (current && current !== boundary) {
    if (current.id && !avoidId) {
      segments.unshift(`#${current.id}`);
      break;
    }

    const classes = Array.from(current.classList).filter(c => c.trim() !== '');
    if (classes.length > 0) {
      segments.unshift(`${current.tagName.toLowerCase()}.${classes.join('.')}`);
    } else {
      segments.unshift(current.tagName.toLowerCase());
    }

    if (segments.length >= 4) break;
    current = current.parentElement;
  }

  return segments.join(' > ');
}

// Identifies an element by its position within the DOM tree, relative to
// document.body (same boundary buildSelector stops at). Used to correlate
// page-side hover/click events with nodes in the side panel's tree view.
function elementPath(element) {
  const path = [];
  let current = element;
  while (current && current !== document.body) {
    const parent = current.parentElement;
    if (!parent) break;
    path.unshift(Array.prototype.indexOf.call(parent.children, current));
    current = parent;
  }
  return path;
}

// Serializes the DOM (rooted at document.body) into a plain-object tree the
// side panel can render. Capped at MAX_TREE_NODES so a huge page can't hang
// the side panel or blow up the message payload.
const MAX_TREE_NODES = 500;

function serializeDomTree() {
  let count = 0;
  let truncated = false;

  function walk(element, path) {
    count++;
    const classes = Array.from(element.classList).filter(c => c.trim() !== '');
    const children = [];
    for (let i = 0; i < element.children.length; i++) {
      if (count >= MAX_TREE_NODES) { truncated = true; break; }
      children.push(walk(element.children[i], [...path, i]));
    }
    return { tag: element.tagName.toLowerCase(), id: element.id || null, classes, path, children };
  }

  const tree = walk(document.body, []);
  return { tree, truncated };
}

if (typeof module !== 'undefined') module.exports = { buildSelector, elementPath, serializeDomTree };

// ── Overlay ──────────────────────────────────────────────────────────────────

let overlay = null;

function createOverlay() {
  if (overlay) return;
  overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position:      'fixed',
    pointerEvents: 'none',
    zIndex:        '2147483647',
    border:        '2px solid #3b82f6',
    background:    'rgba(59,130,246,0.1)',
    boxSizing:     'border-box',
    transition:    'all 0.05s ease',
  });
  document.body.appendChild(overlay);
}

function removeOverlay() {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}

function moveOverlayTo(element) {
  if (!overlay) return;
  const r = element.getBoundingClientRect();
  Object.assign(overlay.style, {
    top:    `${r.top}px`,
    left:   `${r.left}px`,
    width:  `${r.width}px`,
    height: `${r.height}px`,
  });
}

// ── Selection mode ────────────────────────────────────────────────────────────

// Set by ENABLE_DOM_VIEW / DISABLE_DOM_VIEW; gates the HOVER_ELEMENT
// forwarding so it only runs while the side panel's optional DOM tree view
// is actually visible.
let domViewEnabled = false;

// mouseover fires once per element-boundary crossing, which on a dense real
// page can be dozens of times a second — sending one runtime message per
// crossing flooded the extension's message channel badly enough to delay
// unrelated messages (including plain selection). Coalesce to at most one
// HOVER_ELEMENT send per ~16ms (one frame), always reflecting the latest target.
const HOVER_THROTTLE_MS = 16;
let hoverTimeoutId = null;
let pendingHoverTarget = null;

// Set while a Container-Mode selection is scoped to a container instance
// (see startSelection's scopeSelector) — null means the whole page is fair
// game, same as today's flat-mode selection.
let scopeRootEl = null;

// Set for the duration of a selection round that must produce a selector
// capable of matching more than once — see buildSelector's avoidId.
let avoidIdInSelector = false;

function isInScope(element) {
  return !scopeRootEl || scopeRootEl.contains(element);
}

function flushHover() {
  hoverTimeoutId = null;
  if (!domViewEnabled || !pendingHoverTarget) return;
  try {
    chrome.runtime.sendMessage({ type: 'HOVER_ELEMENT', path: elementPath(pendingHoverTarget) });
  } catch (err) {
    log('HOVER_ELEMENT send failed', err.message);
  }
}

function onMouseOver(e) {
  if (e.target === overlay) return;

  if (!isInScope(e.target)) {
    // Out of scope — hide the highlight instead of pointing at an element
    // that couldn't be selected anyway.
    if (overlay) overlay.style.opacity = '0';
    return;
  }
  if (overlay) overlay.style.opacity = '1';
  moveOverlayTo(e.target);

  if (!domViewEnabled) return;
  pendingHoverTarget = e.target;
  if (hoverTimeoutId === null) {
    hoverTimeoutId = setTimeout(flushHover, HOVER_THROTTLE_MS);
  }
}

function onClick(e) {
  e.preventDefault();
  e.stopPropagation();

  if (!isInScope(e.target)) {
    // Stay in selection mode — the user just clicked outside the container
    // instance they're supposed to be picking a descendant of.
    log('CLICK outside scope, ignored');
    return;
  }

  const selector = buildSelector(e.target, scopeRootEl, avoidIdInSelector);
  log('CLICK → selector', selector);
  stopSelection();

  // Path is a nice-to-have for the optional tree-view highlight — never let
  // a failure here block the actual field selection.
  let path;
  try {
    path = elementPath(e.target);
  } catch (err) {
    log('elementPath failed', err.message);
  }

  log('MSG_OUT ELEMENT_SELECTED', selector);
  chrome.runtime.sendMessage({ type: 'ELEMENT_SELECTED', selector, path });
}

// scopeSelector (optional): Container-Mode passes the immediate parent
// group's selector when adding a nested container/field, so only
// descendants of that group's first matching instance can be picked (the
// same "first instance is the template" assumption point-and-click already
// relies on for a repeating group). No match on the current page → the
// selection can't proceed, same SELECTION_UNAVAILABLE path as a missing
// content script.
function startSelection(scopeSelector, avoidId) {
  log('SELECTION start', { scopeSelector, avoidId });
  avoidIdInSelector = !!avoidId;
  if (scopeSelector) {
    scopeRootEl = document.querySelector(scopeSelector);
    if (!scopeRootEl) {
      log('SELECTION scope not found', scopeSelector);
      chrome.runtime.sendMessage({
        type: 'SELECTION_UNAVAILABLE',
        reason: `Container-Selektor '${scopeSelector}' findet kein Element auf dieser Seite.`,
      });
      return;
    }
  } else {
    scopeRootEl = null;
  }
  createOverlay();
  document.addEventListener('mouseover', onMouseOver);
  document.addEventListener('click', onClick, true);
}

function stopSelection() {
  log('SELECTION stop');
  document.removeEventListener('mouseover', onMouseOver);
  document.removeEventListener('click', onClick, true);
  removeOverlay();
  scopeRootEl = null;
  avoidIdInSelector = false;
  if (hoverTimeoutId !== null) {
    clearTimeout(hoverTimeoutId);
    hoverTimeoutId = null;
  }
  pendingHoverTarget = null;
}

function enableDomView() {
  domViewEnabled = true;
  log('DOM_VIEW enable → sending tree');
  try {
    chrome.runtime.sendMessage({ type: 'DOM_TREE', ...serializeDomTree() });
  } catch (err) {
    log('DOM_TREE send failed', err.message);
    chrome.runtime.sendMessage({ type: 'DOM_TREE', tree: null, truncated: false, error: err.message });
  }
}

function disableDomView() {
  log('DOM_VIEW disable');
  domViewEnabled = false;
  if (hoverTimeoutId !== null) {
    clearTimeout(hoverTimeoutId);
    hoverTimeoutId = null;
  }
}

// ── Message listener ──────────────────────────────────────────────────────────

if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    log('MSG_IN', message.type);
    if (message.type === 'START_SELECTION') startSelection(message.scopeSelector, message.avoidId);
    if (message.type === 'STOP_SELECTION')  stopSelection();
    if (message.type === 'ENABLE_DOM_VIEW') enableDomView();
    if (message.type === 'DISABLE_DOM_VIEW') disableDomView();
    if (message.type === 'GET_LOGS') {
      sendResponse(getLogBuffer());
    }
  });
}
