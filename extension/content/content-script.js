// Exported for testing (Jest/jsdom). In the extension build the chrome API
// calls are guarded by the message listener below.
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

if (typeof module !== 'undefined') module.exports = { buildSelector };

// ── Overlay ──────────────────────────────────────────────────────────────────

let overlay = null;

function createOverlay() {
  if (overlay) return;
  overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position:        'fixed',
    pointerEvents:   'none',
    zIndex:          '2147483647',
    border:          '2px solid #3b82f6',
    background:      'rgba(59,130,246,0.1)',
    boxSizing:       'border-box',
    transition:      'all 0.05s ease',
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

function onMouseOver(e) {
  if (e.target === overlay) return;
  moveOverlayTo(e.target);
}

function onClick(e) {
  e.preventDefault();
  e.stopPropagation();

  const selector = buildSelector(e.target);
  stopSelection();
  chrome.runtime.sendMessage({ type: 'ELEMENT_SELECTED', selector });
}

function startSelection() {
  createOverlay();
  document.addEventListener('mouseover', onMouseOver);
  document.addEventListener('click', onClick, true);
}

function stopSelection() {
  document.removeEventListener('mouseover', onMouseOver);
  document.removeEventListener('click', onClick, true);
  removeOverlay();
}

// ── Message listener ──────────────────────────────────────────────────────────

if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'START_SELECTION') startSelection();
    if (message.type === 'STOP_SELECTION')  stopSelection();
  });
}
