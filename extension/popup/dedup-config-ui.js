// Deduplication by key field(s) (Issue #225) — DOM rendering and event
// wiring for the "Deduplication" subsection of the Settings section (see
// dedup-config.js for the pure draft/wire logic, the same
// <feature>.js/<feature>-ui.js split every other popup feature uses). Every
// function that touches state takes popup.js's `bridge` as its first
// parameter, per Architecture Decision #13.
//
// State this module owns:
//   _state.deduplication — { enabled, keyFields, incremental, appendOutput,
//                            retentionKind, retentionValueText }
const SFDedupConfigUI = (function () {
  const { t } = typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;
  const { collectFieldNames } =
    typeof require !== 'undefined' ? require('./scraping-config-builder') : self.SFScrapingConfigBuilder;
  const { addKeyField, removeKeyField, setRetentionKind } =
    typeof require !== 'undefined' ? require('./dedup-config') : self.SFDedupConfig;

  // Duplicated from settings-panel-ui.js's own copy rather than imported —
  // the codebase's "no cross-module includes for small DOM helpers" convention.
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function patchDedup(bridge, patch) {
    const state = bridge.getState();
    bridge.setState(state.current, { deduplication: { ...state.deduplication, ...patch } });
  }

  // Container mode and API mode's tree response shape write an XML /
  // nested-JSON document, which has no meaningful "append" — the Append
  // choice is disabled there (and buildDeduplicationConfig falls back to
  // Delta regardless of what the draft says).
  function isTreeShape(state) {
    return state.mode === 'container' || (state.mode === 'api' && (state.apiConfig?.groups?.length ?? 0) > 0);
  }

  function renderDedupSection(bridge) {
    const state = bridge.getState();
    const dedup = state.deduplication;

    // Not offered for Combined/Blocks: neither has a single field/tree
    // config of its own at the outer level to deduplicate (a component's own
    // config could, but is configured elsewhere) — the companion rejects
    // the combination outright.
    document.getElementById('dedup-section')?.classList.toggle('hidden', state.mode === 'combined' || state.mode === 'blocks');

    const toggle = /** @type {HTMLInputElement | null} */ (document.getElementById('toggle-dedup'));
    if (toggle) toggle.checked = dedup.enabled;
    document.getElementById('dedup-config')?.classList.toggle('hidden', !dedup.enabled);

    renderKeyFieldList(state, dedup);

    const incremental = /** @type {HTMLInputElement | null} */ (document.getElementById('toggle-dedup-incremental'));
    if (incremental) incremental.checked = dedup.incremental;
    document.getElementById('dedup-incremental-config')?.classList.toggle('hidden', !dedup.incremental);

    const tree = isTreeShape(state);
    const appendActive = dedup.appendOutput && !tree;
    document.getElementById('btn-dedup-output-delta')?.classList.toggle('active', !appendActive);
    const appendBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-dedup-output-append'));
    if (appendBtn) {
      appendBtn.classList.toggle('active', appendActive);
      appendBtn.disabled = tree;
      appendBtn.title = tree ? t('idle.dedupAppendUnavailableTitle') : '';
    }

    const kindSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('select-dedup-retention-kind'));
    if (kindSelect && document.activeElement !== kindSelect) kindSelect.value = dedup.retentionKind;
    const valueInput = /** @type {HTMLInputElement | null} */ (document.getElementById('input-dedup-retention-value'));
    if (valueInput && document.activeElement !== valueInput) valueInput.value = dedup.retentionValueText;
  }

  // One row per chosen key field plus a shared <select>/button pair to add a
  // new one, filtered to exclude names already chosen — the same shape the
  // required-fields hardening list uses. A chosen name that has since
  // dropped out of the current field list stays visible (marked) instead of
  // vanishing silently; buildDeduplicationConfig leaves it out of the request.
  function renderKeyFieldList(state, dedup) {
    const available = collectFieldNames(state.mode, state.fields, state.groups, state.apiConfig);
    const list = document.getElementById('dedup-key-fields-list');
    if (list) {
      list.innerHTML = '';
      dedup.keyFields.forEach((name, i) => {
        const missing = !available.includes(name);
        const rowEl = document.createElement('div');
        rowEl.className = 'hardening-required-field-row';
        rowEl.innerHTML =
          `<span class="hardening-required-field-name">${escapeHtml(name)}${missing ? ` <em>(${escapeHtml(t('idle.dedupKeyFieldMissing'))})</em>` : ''}</span>` +
          `<button type="button" class="btn-danger btn-tiny btn-remove-dedup-key-field" data-index="${i}">${escapeHtml(t('common.remove'))}</button>`;
        list.appendChild(rowEl);
      });
    }

    const addable = available.filter(name => !dedup.keyFields.includes(name));
    const select = /** @type {HTMLSelectElement | null} */ (document.getElementById('select-dedup-key-field'));
    if (select) {
      select.innerHTML = addable.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
      select.disabled = addable.length === 0;
    }
    const addBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-add-dedup-key-field'));
    if (addBtn) addBtn.disabled = addable.length === 0;
  }

  function wireDedupEvents(bridge) {
    document.getElementById('toggle-dedup')?.addEventListener('change', (e) => {
      patchDedup(bridge, { enabled: /** @type {HTMLInputElement} */ (e.target).checked });
    });
    document.getElementById('btn-add-dedup-key-field')?.addEventListener('click', () => {
      const select = /** @type {HTMLSelectElement | null} */ (document.getElementById('select-dedup-key-field'));
      const name = select?.value;
      if (!name) return;
      const next = addKeyField(bridge.getState().deduplication, name);
      patchDedup(bridge, { keyFields: next.keyFields });
    });
    document.getElementById('dedup-key-fields-list')?.addEventListener('click', (e) => {
      const btn = /** @type {HTMLElement} */ (e.target).closest('.btn-remove-dedup-key-field');
      if (!btn) return;
      const next = removeKeyField(bridge.getState().deduplication, Number(btn.getAttribute('data-index')));
      patchDedup(bridge, { keyFields: next.keyFields });
    });
    document.getElementById('toggle-dedup-incremental')?.addEventListener('change', (e) => {
      patchDedup(bridge, { incremental: /** @type {HTMLInputElement} */ (e.target).checked });
    });
    document.getElementById('btn-dedup-output-delta')?.addEventListener('click', () => patchDedup(bridge, { appendOutput: false }));
    document.getElementById('btn-dedup-output-append')?.addEventListener('click', () => patchDedup(bridge, { appendOutput: true }));
    document.getElementById('select-dedup-retention-kind')?.addEventListener('change', (e) => {
      const next = setRetentionKind(bridge.getState().deduplication, /** @type {HTMLSelectElement} */ (e.target).value === 'MaxAge' ? 'MaxAge' : 'MaxCount');
      patchDedup(bridge, { retentionKind: next.retentionKind, retentionValueText: next.retentionValueText });
    });
    document.getElementById('input-dedup-retention-value')?.addEventListener('input', (e) => {
      patchDedup(bridge, { retentionValueText: /** @type {HTMLInputElement} */ (e.target).value });
    });
  }

  return { renderDedupSection, wireDedupEvents };
})();

if (typeof module !== 'undefined') module.exports = SFDedupConfigUI;
if (typeof self !== 'undefined') self.SFDedupConfigUI = SFDedupConfigUI;
