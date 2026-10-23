// Custom request headers for flat/container/Blocks mode (Issue #226) — DOM
// rendering and event wiring for the "Request headers" subsection of the
// Settings section (see request-headers.ts for the pure draft/wire logic, the
// same <feature>.js/<feature>-ui.js split every other popup feature uses).
// Every function that touches state takes popup.js's `bridge` as its first
// parameter, per Architecture Decision #13.
//
// State this module owns:
//   _state.requestHeaders         — { enabled, rows: [{ name, kind, value }] }, persisted
//   _state.requestHeaderTestValues — one-time test values keyed by environment
//                                    variable name; memory only, never persisted
//                                    (same treatment as fillTestValues)
const { t } = require('../i18n/i18n');
const { addHeaderRow, appendHeaderRow, removeHeaderRow, updateHeaderRow } = require('./request-headers');
const {
  REQUEST_HEADER_PRESETS, OTHER_PRESET_ID, presetById, presetForName, rowFromPreset,
  isSecretHeaderName, suggestHeaderEnvName,
} = require('./request-header-presets');

// Duplicated from the other -ui modules' own copies rather than imported —
// the codebase's "no cross-module includes for small DOM helpers" convention.
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function patchHeaders(bridge, next) {
  bridge.setState(bridge.getState().current, { requestHeaders: next });
}

// The line(s) under a row's inputs (Issue #402): what a recognised header is
// for, and — for a credential-looking header holding a fixed value — a
// warning that the value would sit in the script as plain text. Not an input,
// so it can be refreshed in place without disturbing the focused field.
function notesHtml(row) {
  const preset = presetForName(row.name);
  const parts = [];
  if (preset) parts.push(`<p class="request-header-desc">${escapeHtml(t(`requestHeaderPresets.${preset.id}.desc`))}</p>`);
  if (row.kind !== 'env' && isSecretHeaderName(row.name)) {
    parts.push(`<p class="request-header-secret-warning" role="alert">${escapeHtml(t('idle.requestHeaderSecretWarning'))} <button type="button" class="btn-secondary btn-tiny request-header-switch-env">${escapeHtml(t('idle.requestHeaderSwitchToEnv'))}</button></p>`);
  }
  return parts.join('');
}

function rowHtml(row, index, testValues) {
  const isEnv = row.kind === 'env';
  const testValue = isEnv ? (testValues[row.value.trim()] || '') : '';
  return `
      <div class="request-header-row" data-index="${index}">
        <input type="text" class="request-header-name" value="${escapeHtml(row.name)}" placeholder="${escapeHtml(t('idle.requestHeaderNamePlaceholder'))}" autocomplete="off" spellcheck="false" />
        <select class="request-header-kind">
          <option value="value"${isEnv ? '' : ' selected'}>${escapeHtml(t('idle.requestHeaderKindValue'))}</option>
          <option value="env"${isEnv ? ' selected' : ''}>${escapeHtml(t('idle.requestHeaderKindEnv'))}</option>
        </select>
        <input type="text" class="request-header-value"${isEnv ? ' data-env-var' : ''} value="${escapeHtml(row.value)}" placeholder="${escapeHtml(t(isEnv ? 'envVar.placeholder.header' : 'idle.requestHeaderValuePlaceholder'))}" autocomplete="off" spellcheck="false" />
        ${isEnv && row.value.trim() ? `<input type="password" class="request-header-test-value" value="${escapeHtml(testValue)}" placeholder="${escapeHtml(t('envVar.testValuePlaceholder'))}" autocomplete="off" />` : ''}
        <button type="button" class="btn-danger btn-tiny btn-remove-request-header" data-index="${index}">${escapeHtml(t('common.remove'))}</button>
        <div class="request-header-notes">${notesHtml(row)}</div>
      </div>`;
}

function renderRequestHeadersSection(bridge) {
  const state = bridge.getState();
  const headers = state.requestHeaders;

  // API mode has its own header editor (adopted from the recorded request)
  // and a Combined request carries its headers per component, so neither
  // offers this — the companion rejects the combinations outright.
  document.getElementById('request-headers-section')?.classList.toggle('hidden', state.mode === 'api' || state.mode === 'combined');

  const toggle = /** @type {HTMLInputElement | null} */ (document.getElementById('toggle-request-headers'));
  if (toggle) toggle.checked = headers.enabled;
  document.getElementById('request-headers-config')?.classList.toggle('hidden', !headers.enabled);

  renderHeaderPicker(headers);

  // Rebuilt only when the *structure* changes (rows added/removed, a row's
  // kind switched); otherwise the existing inputs are updated in place, and
  // never the focused one. Committing one input (a `change` fires as the
  // focus moves on, e.g. name → Tab → value) goes through a full render
  // pass, and tearing the row down then would destroy the very input the
  // user just moved into — and so would a test-value keystroke.
  const list = document.getElementById('request-headers-list');
  if (!list) return;
  const testValues = state.requestHeaderTestValues || {};
  const structure = headers.rows.map((row) => row.kind).join(',');
  if (list.dataset.structure !== structure || list.children.length !== headers.rows.length) {
    list.dataset.structure = structure;
    list.innerHTML = headers.rows.map((row, i) => rowHtml(row, i, testValues)).join('');
    list.querySelectorAll('.request-header-notes').forEach((el) => { el.dataset.signature = el.innerHTML; });
    return;
  }
  headers.rows.forEach((row, i) => syncRow(list.children[i], row, testValues));
}

// The "Add a header…" picker (Issue #402). Rebuilt only when its labels or
// which presets are already in use change (a language switch, a row added or
// renamed), so it never flickers under an open dropdown.
function renderHeaderPicker(headers) {
  const select = /** @type {HTMLSelectElement | null} */ (document.getElementById('select-add-request-header'));
  if (!select) return;
  const used = new Set(headers.rows.map((row) => row.name.trim().toLowerCase()));
  const options = [
    { value: '', label: t('idle.requestHeaderPickerPlaceholder'), disabled: false },
    ...REQUEST_HEADER_PRESETS.map((preset) => ({
      value: preset.id,
      label: t(`requestHeaderPresets.${preset.id}.label`),
      // The companion rejects the same header twice, so don't offer it again.
      disabled: used.has(preset.name.toLowerCase()),
    })),
    { value: OTHER_PRESET_ID, label: t('requestHeaderPresets.other.label'), disabled: false },
  ];
  const signature = JSON.stringify(options);
  if (select.dataset.signature === signature) return;
  select.dataset.signature = signature;
  select.setAttribute('aria-label', t('idle.requestHeaderPickerPlaceholder'));
  select.innerHTML = options
    .map((o) => `<option value="${escapeHtml(o.value)}"${o.disabled ? ' disabled' : ''}>${escapeHtml(o.label)}</option>`)
    .join('');
  select.value = '';
}

function setIfIdle(input, value) {
  if (input && document.activeElement !== input && input.value !== value) input.value = value;
}

// The test-value box depends on the variable name (it is keyed by it), so it
// appears/disappears here when that name goes from empty to set and back —
// as a plain element insert/remove, not a row rebuild.
function syncRow(rowEl, row, testValues) {
  setIfIdle(rowEl.querySelector('.request-header-name'), row.name);
  setIfIdle(rowEl.querySelector('.request-header-value'), row.value);
  const needsTestInput = row.kind === 'env' && Boolean(row.value.trim());
  let testInput = rowEl.querySelector('.request-header-test-value');
  if (needsTestInput && !testInput) {
    testInput = document.createElement('input');
    testInput.type = 'password';
    testInput.className = 'request-header-test-value';
    testInput.placeholder = t('envVar.testValuePlaceholder');
    testInput.autocomplete = 'off';
    rowEl.insertBefore(testInput, rowEl.querySelector('.btn-remove-request-header'));
  } else if (!needsTestInput && testInput) {
    testInput.remove();
    testInput = null;
  }
  if (testInput) setIfIdle(testInput, testValues[row.value.trim()] || '');

  const notesEl = rowEl.querySelector('.request-header-notes');
  const notes = notesHtml(row);
  if (notesEl && notesEl.dataset.signature !== notes) {
    notesEl.dataset.signature = notes;
    notesEl.innerHTML = notes;
  }
}

function wireRequestHeadersEvents(bridge) {
  document.getElementById('toggle-request-headers')?.addEventListener('change', (e) => {
    const next = { ...bridge.getState().requestHeaders, enabled: /** @type {HTMLInputElement} */ (e.target).checked };
    patchHeaders(bridge, next);
  });
  // Picking a header from the list adds a ready-to-use row (Issue #402); the
  // select goes back to its placeholder so the next pick starts fresh.
  document.getElementById('select-add-request-header')?.addEventListener('change', (e) => {
    const select = /** @type {HTMLSelectElement} */ (e.target);
    const id = select.value;
    select.value = '';
    if (!id) return;
    const headers = bridge.getState().requestHeaders;
    const preset = presetById(id);
    patchHeaders(bridge, id === OTHER_PRESET_ID || !preset ? addHeaderRow(headers) : appendHeaderRow(headers, rowFromPreset(preset)));
  });

  const list = document.getElementById('request-headers-list');
  list?.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const switchBtn = target.closest('.request-header-switch-env');
    if (switchBtn) {
      // A credential-looking header with a fixed value → environment variable,
      // with a suggested variable name so the row stays complete.
      const rowEl = switchBtn.closest('.request-header-row');
      const index = Number(rowEl?.getAttribute('data-index'));
      const row = bridge.getState().requestHeaders.rows[index];
      if (row) patchHeaders(bridge, updateHeaderRow(bridge.getState().requestHeaders, index, { kind: 'env', value: suggestHeaderEnvName(row.name) }));
      return;
    }
    const btn = target.closest('.btn-remove-request-header');
    if (!btn) return;
    patchHeaders(bridge, removeHeaderRow(bridge.getState().requestHeaders, Number(btn.getAttribute('data-index'))));
  });
  // Name/value/kind commit on `change` (blur/enter), like the other row
  // editors here — a re-render per keystroke would steal the focus.
  list?.addEventListener('change', (e) => {
    const target = /** @type {HTMLInputElement} */ (e.target);
    const rowEl = target.closest('.request-header-row');
    if (!rowEl) return;
    const index = Number(rowEl.getAttribute('data-index'));
    const headers = bridge.getState().requestHeaders;
    if (target.classList.contains('request-header-name')) patchHeaders(bridge, updateHeaderRow(headers, index, { name: target.value }));
    else if (target.classList.contains('request-header-value')) patchHeaders(bridge, updateHeaderRow(headers, index, { value: target.value }));
    else if (target.classList.contains('request-header-kind')) patchHeaders(bridge, updateHeaderRow(headers, index, { kind: target.value === 'env' ? 'env' : 'value', value: '' }));
  });
  // A one-time test value is keyed by the variable's name and never touches
  // requestHeaders (which is persisted) — only requestHeaderTestValues.
  list?.addEventListener('input', (e) => {
    const target = /** @type {HTMLInputElement} */ (e.target);
    if (!target.classList.contains('request-header-test-value')) return;
    const rowEl = target.closest('.request-header-row');
    const index = Number(rowEl?.getAttribute('data-index'));
    const row = bridge.getState().requestHeaders.rows[index];
    const envName = row?.value?.trim();
    if (!envName) return;
    bridge.patchState({ requestHeaderTestValues: { ...bridge.getState().requestHeaderTestValues, [envName]: target.value } });
  });
}

module.exports = { renderRequestHeadersSection, wireRequestHeadersEvents };

