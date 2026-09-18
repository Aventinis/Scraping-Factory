// ── Local saved-configuration history (Issue #141) + saved run outputs
// (Issue #202) ───────────────────────────────────────────────────────────────
// Extracted from popup.js (see CLAUDE.md's "Popup module boundaries"
// architecture decision) — everything talking to the companion's local
// SQLite-backed /configs and /configs/{id}/outputs endpoints, plus the
// "Saved configurations" panel's own rendering, lives here. Functions take
// a `bridge` object (same convention as api-config-ui.js/companion-client.js)
// instead of closing over popup.js's own module-level state.
const SFSavedConfigsUI = (function() {
const { createLogger } =
  typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
const log = createLogger('SF:Popup');

const { t } =
  typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;

const { STATES, escapeHtml } =
  typeof require !== 'undefined' ? require('./api-config') : self.SFApiConfig;

const { showToast } =
  typeof require !== 'undefined' ? require('./toast') : self.SFToast;

const { buildScrapingConfig } =
  typeof require !== 'undefined' ? require('./scraping-config-builder') : self.SFScrapingConfigBuilder;

const { downloadFile } =
  typeof require !== 'undefined' ? require('./download-helpers') : self.SFDownloadHelpers;

const { getResolvedCompanionUrl } =
  typeof require !== 'undefined' ? require('./companion-client') : self.SFCompanionClient;

const { applyConfigToState } =
  typeof require !== 'undefined' ? require('./config-import') : self.SFConfigImport;

// Issue #141: renders _state.savedConfigs (scoped to the current page's
// hostname, see fetchSavedConfigs) as a Load/Delete row per entry. A row
// whose id matches savedConfigsPendingDeleteId swaps to an inline
// "Delete? Yes/No" confirm instead — see requestDeleteSavedConfig/
// deleteSavedConfig's own doc comments on why this one action gets a
// confirm step when nothing else in this popup does.
function renderSavedConfigsList(bridge) {
  const state = bridge.getState();
  const listEl = document.getElementById('saved-configs-list');
  const emptyEl = document.getElementById('saved-configs-empty');
  if (!listEl) return;
  listEl.innerHTML = '';

  const savedConfigs = state.savedConfigs || [];
  if (emptyEl) emptyEl.classList.toggle('hidden', savedConfigs.length > 0);

  savedConfigs.forEach((entry) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'saved-config-row';
    const savedDate = new Date(entry.savedAt);
    const savedAtText = Number.isNaN(savedDate.getTime()) ? entry.savedAt : savedDate.toLocaleString();

    if (state.savedConfigsPendingDeleteId === entry.id) {
      rowEl.innerHTML =
        `<span class="saved-config-name">${escapeHtml(entry.name)}</span>` +
        `<span class="saved-config-confirm-text">${escapeHtml(t('idle.savedConfigsDeleteConfirm'))}</span>` +
        `<button type="button" class="btn-danger btn-tiny btn-saved-config-delete-confirm" data-id="${entry.id}">${escapeHtml(t('idle.savedConfigsDeleteConfirmYes'))}</button>` +
        `<button type="button" class="btn-secondary btn-tiny btn-saved-config-delete-cancel" data-id="${entry.id}">${escapeHtml(t('idle.savedConfigsDeleteConfirmNo'))}</button>`;
    } else {
      // Issue #202: "Outputs" toggles a sub-panel of this config's own
      // saved run outputs, appended right after the row below.
      const outputsExpanded = state.savedConfigsExpandedId === entry.id;
      rowEl.innerHTML =
        `<span class="saved-config-name" title="${escapeHtml(entry.url)}">${escapeHtml(entry.name)}</span>` +
        `<span class="saved-config-date">${escapeHtml(savedAtText)}</span>` +
        `<button type="button" class="btn-secondary btn-tiny btn-saved-config-load" data-id="${entry.id}">${escapeHtml(t('idle.savedConfigsLoadBtn'))}</button>` +
        `<button type="button" class="btn-secondary btn-tiny btn-saved-config-outputs-toggle" data-id="${entry.id}">${escapeHtml(t(outputsExpanded ? 'idle.savedConfigsOutputsHideBtn' : 'idle.savedConfigsOutputsBtn'))}</button>` +
        `<button type="button" class="btn-danger btn-tiny btn-saved-config-delete" data-id="${entry.id}">${escapeHtml(t('idle.savedConfigsDeleteBtn'))}</button>`;
    }
    listEl.appendChild(rowEl);

    if (state.savedConfigsExpandedId === entry.id) {
      listEl.appendChild(buildSavedOutputsPanelEl(bridge, entry.id));
    }
  });
}

// Issue #202: the sub-panel for one saved-config row's own saved outputs
// (see toggleSavedConfigOutputs/fetchSavedOutputs) — a row per output with
// Download/Delete, the same inline-confirm-before-delete pattern
// renderSavedConfigsList's own rows already use.
function buildSavedOutputsPanelEl(bridge, configId) {
  const state = bridge.getState();
  const panelEl = document.createElement('div');
  panelEl.className = 'saved-outputs-panel';

  if (state.savedOutputsLoading || state.savedOutputs === null) {
    panelEl.innerHTML = `<p class="saved-outputs-loading">${escapeHtml(t('idle.savedOutputsLoading'))}</p>`;
    return panelEl;
  }

  if (state.savedOutputs.length === 0) {
    panelEl.innerHTML = `<p class="saved-outputs-empty">${escapeHtml(t('idle.savedOutputsEmpty'))}</p>`;
    return panelEl;
  }

  state.savedOutputs.forEach((entry) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'saved-output-row';
    const savedDate = new Date(entry.savedAt);
    const savedAtText = Number.isNaN(savedDate.getTime()) ? entry.savedAt : savedDate.toLocaleString();

    if (state.savedOutputsPendingDeleteId === entry.id) {
      rowEl.innerHTML =
        `<span class="saved-output-name">${escapeHtml(entry.name)}</span>` +
        `<span class="saved-config-confirm-text">${escapeHtml(t('idle.savedOutputsDeleteConfirm'))}</span>` +
        `<button type="button" class="btn-danger btn-tiny btn-saved-output-delete-confirm" data-config-id="${configId}" data-id="${entry.id}">${escapeHtml(t('idle.savedConfigsDeleteConfirmYes'))}</button>` +
        `<button type="button" class="btn-secondary btn-tiny btn-saved-output-delete-cancel" data-id="${entry.id}">${escapeHtml(t('idle.savedConfigsDeleteConfirmNo'))}</button>`;
    } else {
      rowEl.innerHTML =
        `<span class="saved-output-name" title="${escapeHtml(entry.fileName)}">${escapeHtml(entry.name)}</span>` +
        `<span class="saved-config-date">${escapeHtml(savedAtText)}</span>` +
        `<button type="button" class="btn-secondary btn-tiny btn-saved-output-download" data-config-id="${configId}" data-id="${entry.id}">${escapeHtml(t('idle.savedOutputsDownloadBtn'))}</button>` +
        `<button type="button" class="btn-danger btn-tiny btn-saved-output-delete" data-id="${entry.id}">${escapeHtml(t('idle.savedConfigsDeleteBtn'))}</button>`;
    }
    panelEl.appendChild(rowEl);
  });

  return panelEl;
}

// Issue #141: local SQLite-backed configuration history — plain fetch
// wrappers against the companion's /configs endpoints, same style as
// companion-client.js's generate()/checkCompanion().

async function fetchSavedConfigs(bridge, url) {
  bridge.patchState({ savedConfigsLoading: true });
  try {
    const res = await fetch(`${getResolvedCompanionUrl()}/configs?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const savedConfigs = await res.json();
    log('SAVED_CONFIGS_LIST', savedConfigs.length);
    bridge.patchState({ savedConfigs, savedConfigsLoading: false });
  } catch (err) {
    // Non-fatal: an older companion without /configs, or a transient
    // network hiccup — this is an optional, secondary capability, so the
    // panel just stays empty instead of surfacing an error toast for it.
    log('SAVED_CONFIGS_LIST FAIL', err.message);
    bridge.patchState({ savedConfigs: [], savedConfigsLoading: false });
  }
}

async function saveCurrentConfig(bridge, name) {
  const state = bridge.getState();
  const config = buildScrapingConfig(
    state.url, state.mode, state.fields, state.groups, state.apiConfig,
    state.scriptFileName, state.outputFileName, state.engine, state.browserActions, state.includeDataPreview,
    state.useJsonOutput, state.additionalStartUrls, state.changeDetection, state.proxy, state.hardening,
    state.pagination, state.persistentSession, false, state.externalConfig,
  );
  log('SAVE_CONFIG', name);
  try {
    const res = await fetch(`${getResolvedCompanionUrl()}/configs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: state.url, name, config }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log('SAVE_CONFIG OK');
    bridge.patchState({ saveConfigModalOpen: false });
    showToast(t('toast.configSaved'), null, 'info');
    await fetchSavedConfigs(bridge, state.url);
  } catch (err) {
    log('SAVE_CONFIG FAIL', err.message);
    showToast(t('toast.configSaveFailed', { message: err.message }), 'Save configuration');
  }
}

// Issue #141: applies a saved config back into _state — the reverse of
// buildConfigExport/buildScrapingConfig (see applyConfigToState). Reuses
// bridge.setState (not patchState) so the applied config is persisted the
// same way any other IDLE-screen edit already is, surviving a subsequent
// popup close/reopen.
async function loadSavedConfig(bridge, id) {
  log('LOAD_SAVED_CONFIG', id);
  try {
    const res = await fetch(`${getResolvedCompanionUrl()}/configs/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const record = await res.json();
    bridge.setState(STATES.IDLE, applyConfigToState(record.config));
    showToast(t('toast.configLoaded', { name: record.name }), null, 'info');
  } catch (err) {
    log('LOAD_SAVED_CONFIG FAIL', err.message);
    showToast(t('toast.configLoadFailed', { message: err.message }), 'Load configuration');
  }
}

function requestDeleteSavedConfig(bridge, id) {
  bridge.patchState({ savedConfigsPendingDeleteId: id });
}

function cancelDeleteSavedConfig(bridge) {
  bridge.patchState({ savedConfigsPendingDeleteId: null });
}

async function deleteSavedConfig(bridge, id) {
  log('DELETE_SAVED_CONFIG', id);
  try {
    const res = await fetch(`${getResolvedCompanionUrl()}/configs/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
    log('DELETE_SAVED_CONFIG OK');
    bridge.patchState({ savedConfigsPendingDeleteId: null });
    showToast(t('toast.configDeleted'), null, 'info');
    await fetchSavedConfigs(bridge, bridge.getState().url);
  } catch (err) {
    log('DELETE_SAVED_CONFIG FAIL', err.message);
    showToast(t('toast.configDeleteFailed', { message: err.message }), 'Delete configuration');
  }
}

// Opens modal-save-config prefilled with the current page's hostname — the
// exact same flow the idle screen's own "Save configuration" button
// triggers, extracted so Issue #202's save-output modal can offer it as a
// shortcut when there's no saved config yet to link an output to.
function openSaveConfigModal(bridge) {
  log('OPEN save-config modal');
  const state = bridge.getState();
  let defaultName = '';
  try {
    defaultName = new URL(state.url).hostname;
  } catch {
    // state.url isn't a well-formed absolute URL — defaultName stays ''
    // and the input is simply left blank, same as any other unreachable
    // default elsewhere in this popup.
  }
  bridge.patchState({ saveOutputModalOpen: false, saveConfigModalOpen: true });
  const input = document.getElementById('input-save-config-name');
  if (input) input.value = defaultName;
}

// Issue #202: a run's actual output data (_state.outputFile), saved as an
// explicit, opt-in action linked to an already-saved configuration — plain
// fetch wrappers against the companion's /configs/{id}/outputs endpoints,
// same style as fetchSavedConfigs/saveCurrentConfig above.

async function saveCurrentOutput(bridge, configId, name) {
  const state = bridge.getState();
  if (!state.outputFile) return;
  const { fileName, content } = state.outputFile;
  log('SAVE_OUTPUT', configId, name);
  try {
    const res = await fetch(`${getResolvedCompanionUrl()}/configs/${configId}/outputs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, fileName, content }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log('SAVE_OUTPUT OK');
    bridge.patchState({ saveOutputModalOpen: false });
    showToast(t('toast.outputSaved'), null, 'info');
    // If that config's own outputs sub-panel happens to be open right now,
    // refresh it so the newly-saved output shows up without a manual
    // collapse/re-expand.
    if (bridge.getState().savedConfigsExpandedId === configId) await fetchSavedOutputs(bridge, configId);
  } catch (err) {
    log('SAVE_OUTPUT FAIL', err.message);
    showToast(t('toast.outputSaveFailed', { message: err.message }), 'Save output');
  }
}

async function fetchSavedOutputs(bridge, configId) {
  bridge.patchState({ savedOutputsLoading: true });
  try {
    const res = await fetch(`${getResolvedCompanionUrl()}/configs/${configId}/outputs`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const savedOutputs = await res.json();
    log('SAVED_OUTPUTS_LIST', configId, savedOutputs.length);
    bridge.patchState({ savedOutputs, savedOutputsLoading: false });
  } catch (err) {
    log('SAVED_OUTPUTS_LIST FAIL', err.message);
    bridge.patchState({ savedOutputs: [], savedOutputsLoading: false });
  }
}

// Accordion-style: expanding one saved-config row's outputs panel collapses
// whichever other row was previously expanded.
function toggleSavedConfigOutputs(bridge, configId) {
  if (bridge.getState().savedConfigsExpandedId === configId) {
    bridge.patchState({ savedConfigsExpandedId: null, savedOutputs: null, savedOutputsPendingDeleteId: null });
    return;
  }
  log('TOGGLE saved-config-outputs', configId);
  bridge.patchState({
    savedConfigsExpandedId: configId, savedOutputs: null, savedOutputsPendingDeleteId: null,
  });
  fetchSavedOutputs(bridge, configId);
}

async function downloadSavedOutput(configId, id) {
  log('DOWNLOAD_SAVED_OUTPUT', configId, id);
  try {
    const res = await fetch(`${getResolvedCompanionUrl()}/configs/${configId}/outputs/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const record = await res.json();
    downloadFile(record.fileName, record.content);
  } catch (err) {
    log('DOWNLOAD_SAVED_OUTPUT FAIL', err.message);
    showToast(t('toast.outputLoadFailed', { message: err.message }), 'Load output');
  }
}

function requestDeleteSavedOutput(bridge, id) {
  bridge.patchState({ savedOutputsPendingDeleteId: id });
}

function cancelDeleteSavedOutput(bridge) {
  bridge.patchState({ savedOutputsPendingDeleteId: null });
}

async function deleteSavedOutput(bridge, configId, id) {
  log('DELETE_SAVED_OUTPUT', configId, id);
  try {
    const res = await fetch(`${getResolvedCompanionUrl()}/configs/${configId}/outputs/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
    log('DELETE_SAVED_OUTPUT OK');
    bridge.patchState({ savedOutputsPendingDeleteId: null });
    showToast(t('toast.outputDeleted'), null, 'info');
    await fetchSavedOutputs(bridge, configId);
  } catch (err) {
    log('DELETE_SAVED_OUTPUT FAIL', err.message);
    showToast(t('toast.outputDeleteFailed', { message: err.message }), 'Delete output');
  }
}

// Issue #202: populates modal-save-output — a config picker + name input
// when there's at least one saved config for the current hostname already
// (_state.savedConfigs, fetched the same way the "Saved configurations"
// panel's own list already is), or a hint + shortcut into modal-save-config
// otherwise, since an output can't be linked to a config that doesn't
// exist yet.
function renderSaveOutputModal(bridge) {
  const savedConfigs = bridge.getState().savedConfigs || [];
  const hasConfigs = savedConfigs.length > 0;

  document.getElementById('save-output-picker')?.classList.toggle('hidden', !hasConfigs);
  document.getElementById('save-output-no-configs-hint')?.classList.toggle('hidden', hasConfigs);
  document.getElementById('btn-save-output-go-to-save-config')?.classList.toggle('hidden', hasConfigs);
  document.getElementById('btn-save-output-confirm')?.classList.toggle('hidden', !hasConfigs);
  if (!hasConfigs) return;

  const selectEl = document.getElementById('select-save-output-config');
  if (selectEl) {
    selectEl.innerHTML = savedConfigs.map((entry) => {
      const savedDate = new Date(entry.savedAt);
      const savedAtText = Number.isNaN(savedDate.getTime()) ? entry.savedAt : savedDate.toLocaleString();
      return `<option value="${entry.id}">${escapeHtml(entry.name)} (${escapeHtml(savedAtText)})</option>`;
    }).join('');
  }
}

// Wires every button/input this module's own render functions above put on
// the page — "Save configuration"/"Save output" modal open+confirm+cancel,
// and the saved-configs-list's own delegated Load/Delete/Outputs-toggle/
// download row actions (rows are rebuilt on every render(), see
// renderSavedConfigsList, so delegation on the list container itself is the
// only way to keep listeners attached across re-renders).
function wireSavedConfigsEvents(bridge) {
  // Issue #202: "Save output" (DONE screen) opens modal-save-output — a
  // config picker + name input when there's at least one saved config for
  // this hostname already, or a hint + shortcut into modal-save-config
  // otherwise (see renderSaveOutputModal, called from render()).
  document.getElementById('btn-save-output')?.addEventListener('click', () => {
    log('BTN save-output → open modal');
    bridge.patchState({ saveOutputModalOpen: true });
  });
  document.getElementById('btn-save-output-cancel')?.addEventListener('click', () => {
    log('BTN save-output-cancel');
    bridge.patchState({ saveOutputModalOpen: false });
  });
  document.getElementById('btn-save-output-confirm')?.addEventListener('click', () => {
    const configId = parseInt(document.getElementById('select-save-output-config')?.value, 10);
    const name = document.getElementById('input-save-output-name')?.value.trim();
    if (!configId || !name) return;
    log('BTN save-output-confirm', configId, name);
    saveCurrentOutput(bridge, configId, name);
  });
  document.getElementById('input-save-output-name')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const configId = parseInt(document.getElementById('select-save-output-config')?.value, 10);
    const name = e.target.value.trim();
    if (!configId || !name) return;
    saveCurrentOutput(bridge, configId, name);
  });
  document.getElementById('btn-save-output-go-to-save-config')?.addEventListener('click', () => openSaveConfigModal(bridge));

  // Issue #141: "Save configuration" opens modal-save-config (name input,
  // prefilled with the current page's hostname); Load/Delete are wired via
  // delegation on saved-configs-list below since rows are rebuilt on every
  // render() (see renderSavedConfigsList).
  document.getElementById('btn-save-config')?.addEventListener('click', () => openSaveConfigModal(bridge));
  document.getElementById('btn-save-config-cancel')?.addEventListener('click', () => {
    log('BTN save-config-cancel');
    bridge.patchState({ saveConfigModalOpen: false });
  });
  document.getElementById('btn-save-config-confirm')?.addEventListener('click', () => {
    const name = document.getElementById('input-save-config-name')?.value.trim();
    if (!name) return;
    log('BTN save-config-confirm', name);
    saveCurrentConfig(bridge, name);
  });
  document.getElementById('input-save-config-name')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const name = e.target.value.trim();
    if (!name) return;
    saveCurrentConfig(bridge, name);
  });

  document.getElementById('saved-configs-list')?.addEventListener('click', (e) => {
    const loadBtn = e.target.closest('.btn-saved-config-load');
    if (loadBtn) {
      const id = parseInt(loadBtn.dataset.id, 10);
      log('BTN saved-config-load', id);
      loadSavedConfig(bridge, id);
      return;
    }
    const deleteBtn = e.target.closest('.btn-saved-config-delete');
    if (deleteBtn) {
      requestDeleteSavedConfig(bridge, parseInt(deleteBtn.dataset.id, 10));
      return;
    }
    const confirmBtn = e.target.closest('.btn-saved-config-delete-confirm');
    if (confirmBtn) {
      deleteSavedConfig(bridge, parseInt(confirmBtn.dataset.id, 10));
      return;
    }
    const cancelBtn = e.target.closest('.btn-saved-config-delete-cancel');
    if (cancelBtn) {
      cancelDeleteSavedConfig(bridge);
      return;
    }

    // Issue #202: a saved config row's own "Outputs" toggle and, once
    // expanded, its Download/Delete actions — same delegated-listener
    // treatment as the config-level buttons above, since these rows are
    // also rebuilt on every render() (see renderSavedConfigsList).
    const outputsToggleBtn = e.target.closest('.btn-saved-config-outputs-toggle');
    if (outputsToggleBtn) {
      toggleSavedConfigOutputs(bridge, parseInt(outputsToggleBtn.dataset.id, 10));
      return;
    }
    const outputDownloadBtn = e.target.closest('.btn-saved-output-download');
    if (outputDownloadBtn) {
      downloadSavedOutput(
        parseInt(outputDownloadBtn.dataset.configId, 10), parseInt(outputDownloadBtn.dataset.id, 10));
      return;
    }
    const outputDeleteBtn = e.target.closest('.btn-saved-output-delete');
    if (outputDeleteBtn) {
      requestDeleteSavedOutput(bridge, parseInt(outputDeleteBtn.dataset.id, 10));
      return;
    }
    const outputConfirmBtn = e.target.closest('.btn-saved-output-delete-confirm');
    if (outputConfirmBtn) {
      deleteSavedOutput(
        bridge, parseInt(outputConfirmBtn.dataset.configId, 10), parseInt(outputConfirmBtn.dataset.id, 10));
      return;
    }
    const outputCancelBtn = e.target.closest('.btn-saved-output-delete-cancel');
    if (outputCancelBtn) cancelDeleteSavedOutput(bridge);
  });
}

  return {renderSavedConfigsList, buildSavedOutputsPanelEl,
    wireSavedConfigsEvents,
    fetchSavedConfigs, saveCurrentConfig, loadSavedConfig,
    requestDeleteSavedConfig, cancelDeleteSavedConfig, deleteSavedConfig,
    openSaveConfigModal,
    saveCurrentOutput, fetchSavedOutputs, toggleSavedConfigOutputs, downloadSavedOutput,
    requestDeleteSavedOutput, cancelDeleteSavedOutput, deleteSavedOutput,
    renderSaveOutputModal,};
})();

if (typeof module !== 'undefined') module.exports = SFSavedConfigsUI;
if (typeof self !== 'undefined') self.SFSavedConfigsUI = SFSavedConfigsUI;
