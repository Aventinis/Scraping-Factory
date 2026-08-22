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

// ── Logging ───────────────────────────────────────────────────────────────────

function log(event, data) {
  const ts = new Date().toISOString().slice(11, 23);
  data !== undefined
    ? console.log(`[SF:Popup ${ts}]`, event, data)
    : console.log(`[SF:Popup ${ts}]`, event);
}

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
  const prev = _state.current;
  _state = { ..._state, current: newState, ...patch };
  log('STATE', `${prev} → ${newState}`, Object.keys(patch).length ? patch : undefined);
  persistState();
  if (typeof document !== 'undefined') render();
}

// Persists the parts of state that must survive popup close/reopen.
function persistState() {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) return;
  chrome.storage.session
    .set({ fields: _state.fields, url: _state.url })
    .catch(err => log('STORAGE_ERR', err.message));
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

function renderFields(fields = _state.fields) {
  const listEl = document.getElementById('fields-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  fields.forEach((field, i) => {
    const row = document.createElement('div');
    row.className = 'field-row';
    row.innerHTML =
      `<span class="field-name" title="${escapeHtml(field.name)}">${escapeHtml(field.name)}</span>` +
      `<span class="field-selector" title="${escapeHtml(field.selector)}">${escapeHtml(field.selector)}</span>` +
      `<button class="btn-danger btn-remove-field" data-index="${i}">Entfernen</button>`;
    listEl.appendChild(row);
  });
}

// ── Async actions ─────────────────────────────────────────────────────────────

async function checkCompanion() {
  log('HEALTH_CHECK start', COMPANION_URL);
  try {
    const res = await fetch(`${COMPANION_URL}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log('HEALTH_CHECK OK');

    const tabs = await new Promise(resolve =>
      chrome.tabs.query({ active: true, currentWindow: true }, resolve)
    );
    const url = tabs[0]?.url ?? '';
    log('TAB_URL', url);
    setState(STATES.IDLE, { url });
  } catch (err) {
    log('HEALTH_CHECK FAIL', err.message);
    setState(STATES.COMPANION_ERROR);
  }
}

async function generate() {
  setState(STATES.GENERATING);
  const config = buildScrapingConfig(_state.url, _state.fields);
  log('GENERATE request', config);
  try {
    const res = await fetch(`${COMPANION_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const scriptText = await res.text();
    log('GENERATE OK', `${scriptText.length} chars`);
    setState(STATES.DONE, { scriptText });
  } catch (err) {
    log('GENERATE FAIL', err.message);
    setState(STATES.IDLE);
    showToast(`Fehler: ${err.message}`);
  }
}

function triggerDownload() {
  log('DOWNLOAD scraper.py');
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
  log('FIELD_ADD', { name, selector: _state.pendingSelector });
  setState(STATES.IDLE, {
    fields:          addField(_state.fields, name, _state.pendingSelector),
    pendingSelector: null,
  });
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireEvents() {
  document.getElementById('btn-retry')?.addEventListener('click', () => {
    log('BTN retry');
    setState(STATES.CHECKING_COMPANION);
    checkCompanion();
  });

  document.getElementById('btn-add-field')?.addEventListener('click', () => {
    log('BTN add-field → START_SELECTION');
    chrome.runtime.sendMessage({ type: 'START_SELECTION' });
    setState(STATES.SELECTING, { pendingSelector: null });
  });

  document.getElementById('btn-cancel-selection')?.addEventListener('click', () => {
    log('BTN cancel-selection → STOP_SELECTION');
    chrome.runtime.sendMessage({ type: 'STOP_SELECTION' });
    setState(STATES.IDLE);
  });

  document.getElementById('btn-field-confirm')?.addEventListener('click', confirmField);

  document.getElementById('input-field-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmField();
  });

  document.getElementById('btn-field-cancel')?.addEventListener('click', () => {
    log('BTN field-cancel');
    setState(STATES.IDLE, { pendingSelector: null });
  });

  // Event delegation for "Entfernen" buttons in the field list
  document.getElementById('fields-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-remove-field');
    if (!btn) return;
    const index = parseInt(btn.dataset.index, 10);
    log('FIELD_REMOVE', { index, name: _state.fields[index]?.name });
    setState(_state.current, { fields: removeField(_state.fields, index) });
  });

  document.getElementById('btn-generate')?.addEventListener('click', () => {
    log('BTN generate');
    generate();
  });
  document.getElementById('btn-download')?.addEventListener('click', triggerDownload);

  document.getElementById('btn-new-scraper')?.addEventListener('click', () => {
    log('BTN new-scraper → reset state');
    chrome.storage.session.set({ fields: [], url: '' });
    setState(STATES.CHECKING_COMPANION, { fields: [], scriptText: '', url: '' });
    checkCompanion();
  });

  chrome.runtime.onMessage.addListener((message) => {
    log('MSG_IN', message);
    if (message.type === 'ELEMENT_SELECTED' && _state.current === STATES.SELECTING) {
      log('ELEMENT_SELECTED received (real-time)', message.selector);
      // Clear the storage entry the service worker wrote — we have it now.
      chrome.storage.session.remove('pendingSelector');
      setState(STATES.SELECTING, { pendingSelector: message.selector });
    }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  wireEvents();

  log('INIT reading session storage');
  const stored = await chrome.storage.session.get(['fields', 'url', 'pendingSelector']);
  log('INIT restored', stored);

  // Always restore persisted fields and URL.
  if (Array.isArray(stored.fields)) _state = { ..._state, fields: stored.fields };
  if (stored.url)                   _state = { ..._state, url: stored.url };

  if (stored.pendingSelector) {
    // The user clicked an element while the side panel was closed (e.g. it
    // hadn't finished loading yet, or was closed manually).
    // Show the field-name modal immediately without re-checking the companion.
    log('INIT pending selector found → show modal', stored.pendingSelector);
    await chrome.storage.session.remove('pendingSelector');
    setState(STATES.SELECTING, { pendingSelector: stored.pendingSelector });
    return;
  }

  setState(STATES.CHECKING_COMPANION);
  await checkCompanion();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

if (typeof module !== 'undefined') {
  module.exports = { buildScrapingConfig, addField, removeField, escapeHtml, renderFields, STATES };
}
