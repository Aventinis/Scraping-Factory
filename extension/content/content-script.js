// Exported for testing (Jest/jsdom). In the extension build the chrome API
// calls are guarded by the message listener below.

function log(event, data) {
  const ts = new Date().toISOString().slice(11, 23);
  data !== undefined
    ? console.log(`[SF:Content ${ts}]`, event, data)
    : console.log(`[SF:Content ${ts}]`, event);
}

function buildSelector(element) {
  const segments = [];

  let current = element;
  while (current && current !== document.body) {
    if (current.id) {
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
const MAX_TREE_NODES = 1500;

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

// Set by ENABLE_DOM_VIEW / DISABLE_DOM_VIEW; gates the (relatively chatty)
// HOVER_ELEMENT forwarding so it only runs while the side panel's optional
// DOM tree view is actually visible.
let domViewEnabled = false;

function onMouseOver(e) {
  if (e.target === overlay) return;
  moveOverlayTo(e.target);
  if (domViewEnabled) {
    chrome.runtime.sendMessage({ type: 'HOVER_ELEMENT', path: elementPath(e.target) });
  }
}

function onClick(e) {
  e.preventDefault();
  e.stopPropagation();

  const selector = buildSelector(e.target);
  const path = elementPath(e.target);
  log('CLICK → selector', selector);
  stopSelection();
  log('MSG_OUT ELEMENT_SELECTED', selector);
  chrome.runtime.sendMessage({ type: 'ELEMENT_SELECTED', selector, path });
}

function startSelection() {
  log('SELECTION start');
  createOverlay();
  document.addEventListener('mouseover', onMouseOver);
  document.addEventListener('click', onClick, true);
}

function stopSelection() {
  log('SELECTION stop');
  document.removeEventListener('mouseover', onMouseOver);
  document.removeEventListener('click', onClick, true);
  removeOverlay();
}

function enableDomView() {
  domViewEnabled = true;
  log('DOM_VIEW enable → sending tree');
  chrome.runtime.sendMessage({ type: 'DOM_TREE', ...serializeDomTree() });
}

function disableDomView() {
  log('DOM_VIEW disable');
  domViewEnabled = false;
}

// ── Message listener ──────────────────────────────────────────────────────────

if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener((message) => {
    log('MSG_IN', message.type);
    if (message.type === 'START_SELECTION') startSelection();
    if (message.type === 'STOP_SELECTION')  stopSelection();
    if (message.type === 'ENABLE_DOM_VIEW') enableDomView();
    if (message.type === 'DISABLE_DOM_VIEW') disableDomView();
  });
}
