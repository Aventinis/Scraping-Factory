// Issue #279: reusable transform-chain presets — the companion fetch
// wrappers, the "Apply preset… / Save as preset" controls shown under each
// of the three transform editors (flat field modal, container field modal,
// API field-transforms modal), and the preset management section on the
// Settings screen. Pure logic lives in transform-presets.js. Every function
// touching state takes popup.js's `bridge` (Architecture Decision #12).
//
// State owned here:
//   transformPresets                — the companion's saved presets (null
//                                     until first fetched)
//   transformPresetsAvailable       — false when the companion has no
//                                     /transform-presets (older build) or is
//                                     unreachable; only built-ins are offered
//                                     then, and saving is disabled
//   transformPresetSaveOpen         — the inline "name this preset" form is
//                                     showing (only one transform editor is
//                                     ever open at a time, so one flag covers
//                                     all three)
//   transformPresetRenameId / transformPresetDeletePendingId
//                                   — the Settings list's inline rename/
//                                     "Delete? Yes/No" row
const SFTransformPresetsUI = (function () {
  const { createLogger } = typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
  const log = createLogger('SF:TransformPresets');
  const { t } = typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;
  const { getResolvedCompanionUrl } = typeof require !== 'undefined' ? require('./companion-client') : self.SFCompanionClient;
  const { allTransformPresets, applyTransformPreset, transformChainIsSaveable } =
    typeof require !== 'undefined' ? require('./transform-presets') : self.SFTransformPresets;

  // i18n label per transform kind, for a preset's one-line step summary —
  // the same option labels the transform editor's own kind dropdown shows.
  const KIND_LABEL_KEYS = {
    trim: 'transforms.trimOption',
    regexExtract: 'transforms.regexExtractOption',
    replace: 'transforms.replaceOption',
    toNumber: 'transforms.toNumberOption',
    toInteger: 'transforms.toIntegerOption',
    toBoolean: 'transforms.toBooleanOption',
    toDate: 'transforms.toDateOption',
    toCurrency: 'transforms.toCurrencyOption',
  };

  function summarizeTransformChain(transforms) {
    return transforms.map(step => (KIND_LABEL_KEYS[step.kind] ? t(KIND_LABEL_KEYS[step.kind]) : step.kind)).join(' → ');
  }

  // ── Companion round trips ───────────────────────────────────────────────

  async function fetchTransformPresets(bridge) {
    try {
      const res = await fetch(`${getResolvedCompanionUrl()}/transform-presets`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const transformPresets = await res.json();
      log('TRANSFORM_PRESETS_LIST', transformPresets.length);
      bridge.patchState({ transformPresets, transformPresetsAvailable: true });
    } catch (err) {
      // Non-fatal, like fetchOutputBlueprints: an older companion without
      // /transform-presets, or a network hiccup — built-ins still work.
      log('TRANSFORM_PRESETS_LIST FAIL', err.message);
      bridge.patchState({ transformPresets: [], transformPresetsAvailable: false });
    }
  }

  async function errorMessageFrom(res) {
    try {
      return (await res.json()).error || `HTTP ${res.status}`;
    } catch {
      return `HTTP ${res.status}`;
    }
  }

  async function saveTransformPreset(bridge, name, transforms) {
    log('TRANSFORM_PRESET_SAVE', { name, steps: transforms.length });
    try {
      const res = await fetch(`${getResolvedCompanionUrl()}/transform-presets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, transforms }),
      });
      if (!res.ok) {
        bridge.showToast(t('transformPresets.saveFailed', { error: await errorMessageFrom(res) }), null, 'warn');
        return false;
      }
      bridge.patchState({ transformPresetSaveOpen: false });
      bridge.showToast(t('transformPresets.saved', { name }), null, 'info');
      await fetchTransformPresets(bridge);
      return true;
    } catch (err) {
      bridge.showToast(t('transformPresets.saveFailed', { error: err.message }), 'Transform preset save');
      return false;
    }
  }

  async function renameTransformPreset(bridge, id, name) {
    log('TRANSFORM_PRESET_RENAME', { id, name });
    try {
      const res = await fetch(`${getResolvedCompanionUrl()}/transform-presets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        bridge.showToast(t('transformPresets.saveFailed', { error: await errorMessageFrom(res) }), null, 'warn');
        return;
      }
      bridge.patchState({ transformPresetRenameId: null });
      await fetchTransformPresets(bridge);
    } catch (err) {
      bridge.showToast(t('transformPresets.saveFailed', { error: err.message }), 'Transform preset rename');
    }
  }

  async function deleteTransformPreset(bridge, id) {
    log('TRANSFORM_PRESET_DELETE', id);
    try {
      const res = await fetch(`${getResolvedCompanionUrl()}/transform-presets/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      bridge.patchState({ transformPresetDeletePendingId: null });
      await fetchTransformPresets(bridge);
    } catch (err) {
      bridge.showToast(t('transformPresets.deleteFailed', { error: err.message }), 'Transform preset delete');
    }
  }

  // ── Controls under each transform editor ────────────────────────────────
  // Re-rendered on every popup render (cheap), but the DOM is only rebuilt
  // when something the controls actually show changes (`signature`) — so a
  // name being typed into the inline save form isn't wiped by an unrelated
  // re-render, e.g. the live transform preview updating.

  function controlsSignature(state, presets, saveable) {
    return JSON.stringify([presets.map(p => [p.id, p.name]), !!state.transformPresetSaveOpen, saveable, !!state.transformPresetsAvailable]);
  }

  function buildControls(container, state, presets, saveable) {
    container.innerHTML = '';

    const applySelect = document.createElement('select');
    applySelect.className = 'transform-preset-apply-select';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = t('transformPresets.applyPlaceholder');
    applySelect.appendChild(placeholder);
    presets.forEach((preset) => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.builtin ? `${preset.name} ${t('transformPresets.builtinSuffix')}` : preset.name;
      option.title = summarizeTransformChain(preset.transforms);
      applySelect.appendChild(option);
    });
    container.appendChild(applySelect);

    if (state.transformPresetSaveOpen) {
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'transform-preset-name-input';
      nameInput.placeholder = t('transformPresets.namePlaceholder');
      container.appendChild(nameInput);

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'btn-primary btn-tiny btn-transform-preset-save-confirm';
      confirmBtn.textContent = t('transformPresets.saveConfirm');
      container.appendChild(confirmBtn);

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn-secondary btn-tiny btn-transform-preset-save-cancel';
      cancelBtn.textContent = t('common.cancel');
      container.appendChild(cancelBtn);
      setTimeout(() => nameInput.focus(), 0);
    } else {
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn-secondary btn-tiny btn-transform-preset-save';
      saveBtn.textContent = t('transformPresets.saveBtn');
      saveBtn.disabled = !saveable || !state.transformPresetsAvailable;
      saveBtn.title = !state.transformPresetsAvailable
        ? t('transformPresets.saveUnavailableHint')
        : saveable ? '' : t('transformPresets.saveNotPossibleHint');
      container.appendChild(saveBtn);
    }
  }

  function renderTransformPresetControls(bridge) {
    const state = bridge.getState();
    const containers = document.querySelectorAll('.transform-preset-controls');
    if (containers.length === 0) return;
    const presets = allTransformPresets(state.transformPresets, t);
    const saveable = transformChainIsSaveable(state.pendingTransforms || []);
    const signature = controlsSignature(state, presets, saveable);
    containers.forEach((container) => {
      if (container.dataset.signature === signature) return;
      container.dataset.signature = signature;
      buildControls(container, state, presets, saveable);
    });
  }

  function confirmSaveFromControls(bridge, container) {
    const name = container.querySelector('.transform-preset-name-input')?.value.trim();
    if (!name) return;
    saveTransformPreset(bridge, name, bridge.getState().pendingTransforms || []);
  }

  // Delegated on each of the three containers (all already in the DOM — the
  // modal partials are loaded before wireEvents runs), so re-rendering a
  // container's contents never loses its listeners.
  function wireTransformPresetControls(bridge) {
    document.querySelectorAll('.transform-preset-controls').forEach((container) => {
      container.addEventListener('change', (e) => {
        const select = /** @type {HTMLSelectElement} */ (e.target);
        if (!select.classList.contains('transform-preset-apply-select') || !select.value) return;
        const state = bridge.getState();
        const preset = allTransformPresets(state.transformPresets, t).find(p => p.id === select.value);
        select.value = '';
        if (!preset) return;
        log('TRANSFORM_PRESET_APPLY', preset.id);
        bridge.patchState({ pendingTransforms: applyTransformPreset(state.pendingTransforms || [], preset) });
      });

      container.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        if (target.closest('.btn-transform-preset-save')) bridge.patchState({ transformPresetSaveOpen: true });
        else if (target.closest('.btn-transform-preset-save-cancel')) bridge.patchState({ transformPresetSaveOpen: false });
        else if (target.closest('.btn-transform-preset-save-confirm')) confirmSaveFromControls(bridge, container);
      });

      container.addEventListener('keydown', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        if (!target.classList.contains('transform-preset-name-input')) return;
        if (e.key === 'Enter') { e.preventDefault(); confirmSaveFromControls(bridge, container); }
        if (e.key === 'Escape') { e.stopPropagation(); bridge.patchState({ transformPresetSaveOpen: false }); }
      });
    });

    // Closing a field modal (confirm or cancel) also closes a still-open
    // "name this preset" form, so it doesn't reappear in the next modal.
    [
      'btn-field-confirm', 'btn-field-cancel', 'btn-field-extended-confirm', 'btn-field-extended-cancel',
      'btn-api-field-transforms-confirm', 'btn-api-field-transforms-cancel',
    ].forEach((id) => {
      document.getElementById(id)?.addEventListener('click', () => {
        if (bridge.getState().transformPresetSaveOpen) bridge.patchState({ transformPresetSaveOpen: false });
      });
    });
  }

  // ── Settings screen: manage presets ─────────────────────────────────────

  function listSignature(state, presets) {
    return JSON.stringify([presets.map(p => [p.id, p.name, summarizeTransformChain(p.transforms)]), state.transformPresetRenameId, state.transformPresetDeletePendingId]);
  }

  function buildPresetRow(preset, state) {
    const row = document.createElement('div');
    row.className = 'transform-preset-row';
    row.dataset.presetId = preset.builtin ? '' : String(preset.savedId);

    const text = document.createElement('div');
    text.className = 'transform-preset-text';
    if (!preset.builtin && state.transformPresetRenameId === preset.savedId) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'transform-preset-rename-input';
      input.value = preset.name;
      text.appendChild(input);
      setTimeout(() => { input.focus(); input.select(); }, 0);
    } else {
      const name = document.createElement('span');
      name.className = 'transform-preset-name';
      name.textContent = preset.builtin ? `${preset.name} ${t('transformPresets.builtinSuffix')}` : preset.name;
      text.appendChild(name);
    }
    const summary = document.createElement('span');
    summary.className = 'transform-preset-summary';
    summary.textContent = summarizeTransformChain(preset.transforms);
    text.appendChild(summary);
    row.appendChild(text);

    if (preset.builtin) return row;

    const actions = document.createElement('div');
    actions.className = 'transform-preset-actions';
    const button = (className, labelKey, danger = false) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `${danger ? 'btn-danger' : 'btn-secondary'} btn-tiny ${className}`;
      btn.textContent = t(labelKey);
      actions.appendChild(btn);
    };
    if (state.transformPresetRenameId === preset.savedId) {
      button('btn-transform-preset-rename-confirm', 'transformPresets.saveConfirm');
      button('btn-transform-preset-rename-cancel', 'common.cancel');
    } else if (state.transformPresetDeletePendingId === preset.savedId) {
      const prompt = document.createElement('span');
      prompt.className = 'transform-preset-delete-prompt';
      prompt.textContent = t('transformPresets.deleteConfirmPrompt');
      actions.appendChild(prompt);
      button('btn-transform-preset-delete-yes', 'transformPresets.deleteYes', true);
      button('btn-transform-preset-delete-no', 'transformPresets.deleteNo');
    } else {
      button('btn-transform-preset-rename', 'transformPresets.renameBtn');
      button('btn-transform-preset-delete', 'common.remove', true);
    }
    row.appendChild(actions);
    return row;
  }

  function renderTransformPresetsSettings(bridge) {
    const listEl = document.getElementById('transform-presets-list');
    if (!listEl) return;
    const state = bridge.getState();
    const presets = allTransformPresets(state.transformPresets, t);
    const signature = listSignature(state, presets);
    document.getElementById('transform-presets-unavailable')?.classList.toggle('hidden', state.transformPresetsAvailable !== false);
    if (listEl.dataset.signature === signature) return;
    listEl.dataset.signature = signature;
    listEl.innerHTML = '';
    presets.forEach(preset => listEl.appendChild(buildPresetRow(preset, state)));
  }

  function wireTransformPresetsSettings(bridge) {
    const listEl = document.getElementById('transform-presets-list');
    if (!listEl) return;
    const idOf = el => parseInt(el.closest('.transform-preset-row').dataset.presetId, 10);
    const confirmRename = (row) => {
      const name = row.querySelector('.transform-preset-rename-input')?.value.trim();
      if (name) renameTransformPreset(bridge, idOf(row), name);
    };

    listEl.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      const row = target.closest('.transform-preset-row');
      if (!row || !row.dataset.presetId) return;
      if (target.closest('.btn-transform-preset-rename')) bridge.patchState({ transformPresetRenameId: idOf(row), transformPresetDeletePendingId: null });
      else if (target.closest('.btn-transform-preset-rename-cancel')) bridge.patchState({ transformPresetRenameId: null });
      else if (target.closest('.btn-transform-preset-rename-confirm')) confirmRename(row);
      else if (target.closest('.btn-transform-preset-delete')) bridge.patchState({ transformPresetDeletePendingId: idOf(row), transformPresetRenameId: null });
      else if (target.closest('.btn-transform-preset-delete-no')) bridge.patchState({ transformPresetDeletePendingId: null });
      else if (target.closest('.btn-transform-preset-delete-yes')) deleteTransformPreset(bridge, idOf(row));
    });

    listEl.addEventListener('keydown', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      if (!target.classList.contains('transform-preset-rename-input')) return;
      if (e.key === 'Enter') confirmRename(target.closest('.transform-preset-row'));
      if (e.key === 'Escape') bridge.patchState({ transformPresetRenameId: null });
    });
  }

  return {
    summarizeTransformChain, fetchTransformPresets, saveTransformPreset, renameTransformPreset, deleteTransformPreset,
    renderTransformPresetControls, wireTransformPresetControls, renderTransformPresetsSettings, wireTransformPresetsSettings,
  };
})();

if (typeof module !== 'undefined') module.exports = SFTransformPresetsUI;
if (typeof self !== 'undefined') self.SFTransformPresetsUI = SFTransformPresetsUI;
