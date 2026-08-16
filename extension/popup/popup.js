const COMPANION_URL = 'http://localhost:5000';

const STATES = {
  CHECKING_COMPANION: 'CHECKING_COMPANION',
  COMPANION_ERROR:    'COMPANION_ERROR',
  IDLE:               'IDLE',
  SELECTING:          'SELECTING',
  GENERATING:         'GENERATING',
  DONE:               'DONE',
};

let _state = {
  current:         STATES.CHECKING_COMPANION,
  url:             '',
  fields:          [],   // [{name, selector, attribute}]
  scriptText:      '',
  pendingSelector: null, // set while field-name modal is open
};

// ── Pure functions (exported for testing) ────────────────────────────────────

function buildScrapingConfig(url, fields) {
  return {
    version: '1',
    url,
    fields: fields.map(f => ({ name: f.name, selector: f.selector, attribute: f.attribute ?? null })),
    outputFormat: 'Csv',
  };
}

function addField(fields, name, selector) {
  return [...fields, { name, selector, attribute: null }];
}

function removeField(fields, index) {
  return fields.filter((_, i) => i !== index);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── State ────────────────────────────────────────────────────────────────────

function setState(newState, patch = {}) {
  _state = { ..._state, current: newState, ...patch };
  if (typeof document !== 'undefined') render();
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

function render() {
  ['checking', 'error', 'idle', 'selecting', 'generating', 'done'].forEach(s =>
    hide(`screen-${s}`)
  );
  hide('modal-field-name');

  const screenKey = {
    [STATES.CHECKING_COMPANION]: 'checking',
    [STATES.COMPANION_ERROR]:    'error',
    [STATES.IDLE]:               'idle',
    [STATES.SELECTING]:          'selecting',
    [STATES.GENERATING]:         'generating',
    [STATES.DONE]:               'done',
  }[_state.current];

  if (screenKey) show(`screen-${screenKey}`);

  if (_state.current === STATES.IDLE) {
    const urlEl = document.getElementById('url-display');
    if (urlEl) urlEl.textContent = _state.url || '—';
    renderFields();
    const genBtn = document.getElementById('btn-generate');
    if (genBtn) genBtn.disabled = _state.fields.length === 0;
  }

  // Show modal when an element has been captured during selection
  if (_state.current === STATES.SELECTING && _state.pendingSelector !== null) {
    show('modal-field-name');
    const input = document.getElementById('input-field-name');
    if (input) { input.value = ''; input.focus(); }
  }
}

function renderFields() {
  const listEl = document.getElementById('fields-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  _state.fields.forEach((field, i) => {
    const row = document.createElement('div');
    row.className = 'field-row';
    row.innerHTML =
      `<span class="field-name">${escapeHtml(field.name)}</span>` +
      `<span class="field-selector">${escapeHtml(field.selector)}</span>` +
      `<button class="btn-danger btn-remove-field" data-index="${i}">Entfernen</button>`;
    listEl.appendChild(row);
  });
}

// ── Async actions ─────────────────────────────────────────────────────────────

async function checkCompanion() {
  try {
    const res = await fetch(`${COMPANION_URL}/health`);
    if (!res.ok) throw new Error('not ok');
    const tabs = await new Promise(resolve =>
      chrome.tabs.query({ active: true, currentWindow: true }, resolve)
    );
    setState(STATES.IDLE, { url: tabs[0]?.url ?? '' });
  } catch {
    setState(STATES.COMPANION_ERROR);
  }
}

async function generate() {
  setState(STATES.GENERATING);
  const config = buildScrapingConfig(_state.url, _state.fields);
  try {
    const res = await fetch(`${COMPANION_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const scriptText = await res.text();
    setState(STATES.DONE, { scriptText });
  } catch (err) {
    setState(STATES.IDLE);
    showToast(`Fehler: ${err.message}`);
  }
}

function triggerDownload() {
  const blob = new Blob([_state.scriptText], { type: 'text/plain' });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = 'scraper.py';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

function showToast(message) {
  const toast = document.getElementById('error-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 4000);
}

// ── Field-name modal ──────────────────────────────────────────────────────────

function confirmField() {
  const name = document.getElementById('input-field-name')?.value.trim();
  if (!name) return;
  _state = {
    ..._state,
    fields:          addField(_state.fields, name, _state.pendingSelector),
    pendingSelector: null,
    current:         STATES.IDLE,
  };
  render();
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireEvents() {
  document.getElementById('btn-retry')?.addEventListener('click', () => {
    setState(STATES.CHECKING_COMPANION);
    checkCompanion();
  });

  document.getElementById('btn-add-field')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'START_SELECTION' });
    setState(STATES.SELECTING, { pendingSelector: null });
  });

  document.getElementById('btn-cancel-selection')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_SELECTION' });
    setState(STATES.IDLE);
  });

  document.getElementById('btn-field-confirm')?.addEventListener('click', confirmField);

  document.getElementById('input-field-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmField();
  });

  document.getElementById('btn-field-cancel')?.addEventListener('click', () => {
    // Selection already stopped in content script when the element was clicked;
    // no need to send STOP_SELECTION here.
    setState(STATES.IDLE, { pendingSelector: null });
  });

  // Event delegation for "Entfernen" buttons in the field list
  document.getElementById('fields-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-remove-field');
    if (!btn) return;
    const index = parseInt(btn.dataset.index, 10);
    _state = { ..._state, fields: removeField(_state.fields, index) };
    render();
  });

  document.getElementById('btn-generate')?.addEventListener('click', generate);
  document.getElementById('btn-download')?.addEventListener('click', triggerDownload);

  document.getElementById('btn-new-scraper')?.addEventListener('click', () => {
    setState(STATES.IDLE, { fields: [], scriptText: '' });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'ELEMENT_SELECTED' && _state.current === STATES.SELECTING) {
      setState(STATES.SELECTING, { pendingSelector: message.selector });
    }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { wireEvents(); checkCompanion(); });
  } else {
    wireEvents();
    checkCompanion();
  }
}

if (typeof module !== 'undefined') {
  module.exports = { buildScrapingConfig, addField, removeField, escapeHtml, STATES };
}
