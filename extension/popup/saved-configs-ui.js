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

const { buildScrapingConfig, buildHardeningConfig } =
  typeof require !== 'undefined' ? require('./scraping-config-builder') : self.SFScrapingConfigBuilder;

const { downloadFile } =
  typeof require !== 'undefined' ? require('./download-helpers') : self.SFDownloadHelpers;

const { getResolvedCompanionUrl, resolveCombinedComponents } =
  typeof require !== 'undefined' ? require('./companion-client') : self.SFCompanionClient;

const { applyConfigToState } =
  typeof require !== 'undefined' ? require('./config-import') : self.SFConfigImport;

const { getGlobalSettings } =
  typeof require !== 'undefined' ? require('../shared/global-settings') : self.SFGlobalSettings;

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
        `<button type="button" class="btn-secondary btn-tiny btn-saved-output-replay-hardening" data-config-id="${configId}" data-id="${entry.id}">${escapeHtml(t('idle.savedOutputsReplayHardeningBtn'))}</button>` +
        `<button type="button" class="btn-danger btn-tiny btn-saved-output-delete" data-id="${entry.id}">${escapeHtml(t('idle.savedConfigsDeleteBtn'))}</button>`;
    }
    panelEl.appendChild(rowEl);

    // Issue #207: the in-progress/last "Test hardening" run for this
    // specific output — appended right after its own row, mirroring how
    // this whole outputs sub-panel itself is appended after its own
    // saved-config row.
    if (state.hardeningReplay && state.hardeningReplay.outputId === entry.id) {
      panelEl.appendChild(buildHardeningReplayPanelEl(bridge, entry));
    }
  });

  return panelEl;
}

// Issue #207: renders whichever phase _state.hardeningReplay is currently
// in — a compare-basis choice (only when needed, see startHardeningReplay's
// own doc comment), a loading state, an error, or the per-check results
// themselves (one line per check: kind, outcome, message).
function buildHardeningReplayPanelEl(bridge, outputEntry) {
  const state = bridge.getState();
  const replay = state.hardeningReplay;
  const panelEl = document.createElement('div');
  panelEl.className = 'hardening-replay-panel';

  if (replay.needsCompareBasisChoice) {
    const configEntry = (state.savedConfigs || []).find((c) => c.id === replay.configId);
    const blueprint = (state.outputBlueprints || []).find((bp) => bp.id === configEntry?.blueprintId);
    const blueprintName = blueprint?.name ?? String(configEntry?.blueprintId ?? '');
    panelEl.innerHTML =
      `<p class="hardening-replay-compare-basis-label">${escapeHtml(t('idle.hardeningReplayCompareBasisLabel'))}</p>` +
      `<div class="mode-toggle hardening-replay-compare-basis-toggle">` +
      `<div class="mode-toggle-thumb"></div>` +
      `<button type="button" class="mode-btn btn-hardening-replay-basis${replay.compareBasis === 'config' ? ' active' : ''}" data-basis="config">${escapeHtml(t('idle.hardeningReplayCompareBasisConfig'))}</button>` +
      `<button type="button" class="mode-btn btn-hardening-replay-basis${replay.compareBasis === 'blueprint' ? ' active' : ''}" data-basis="blueprint">${escapeHtml(t('idle.hardeningReplayCompareBasisBlueprint', { name: blueprintName }))}</button>` +
      `</div>` +
      `<button type="button" class="btn-primary btn-tiny btn-hardening-replay-run">${escapeHtml(t('idle.hardeningReplayRunBtn'))}</button>` +
      `<button type="button" class="btn-secondary btn-tiny btn-hardening-replay-cancel">${escapeHtml(t('common.cancel'))}</button>`;
    return panelEl;
  }

  if (replay.loading) {
    panelEl.innerHTML = `<p class="hardening-replay-loading">${escapeHtml(t('idle.hardeningReplayLoading'))}</p>`;
    return panelEl;
  }

  if (replay.error) {
    panelEl.innerHTML =
      `<p class="hardening-replay-error">${escapeHtml(t('idle.hardeningReplayError', { message: replay.error }))}</p>` +
      `<button type="button" class="btn-secondary btn-tiny btn-hardening-replay-cancel">${escapeHtml(t('common.cancel'))}</button>`;
    return panelEl;
  }

  const resultLines = (replay.results || []).map((result) => {
    const outcomeClass = {
      Triggered: 'hardening-replay-result-triggered',
      NotEvaluable: 'hardening-replay-result-inconclusive',
      Inconclusive: 'hardening-replay-result-inconclusive',
      Passed: 'hardening-replay-result-passed',
    }[result.outcome] || '';
    return `<li class="hardening-replay-result ${outcomeClass}">` +
      `<span class="hardening-replay-result-kind">${escapeHtml(result.kind)}</span> ` +
      `<span class="hardening-replay-result-outcome">${escapeHtml(t(`idle.hardeningReplayOutcome${result.outcome}`))}</span>` +
      `<p class="hardening-replay-result-message">${escapeHtml(result.message)}</p>` +
      `</li>`;
  }).join('');
  panelEl.innerHTML =
    `<ul class="hardening-replay-results-list">${resultLines}</ul>` +
    `<button type="button" class="btn-secondary btn-tiny btn-hardening-replay-cancel">${escapeHtml(t('common.cancel'))}</button>`;
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

// Issue #239: the unscoped counterpart to fetchSavedConfigs above — every
// saved configuration regardless of host, needed by Combined mode's
// component picker (a component doesn't have to match the page currently
// open). Fetched once on switching into Combined mode (see switchMode in
// idle-screen-ui.js), same "non-fatal, panel just stays empty" treatment as
// fetchSavedConfigs for an older/unreachable companion.
async function fetchAllSavedConfigs(bridge) {
  bridge.patchState({ allSavedConfigsLoading: true });
  try {
    const res = await fetch(`${getResolvedCompanionUrl()}/configs`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const allSavedConfigs = await res.json();
    log('ALL_SAVED_CONFIGS_LIST', allSavedConfigs.length);
    bridge.patchState({ allSavedConfigs, allSavedConfigsLoading: false });
  } catch (err) {
    log('ALL_SAVED_CONFIGS_LIST FAIL', err.message);
    bridge.patchState({ allSavedConfigs: [], allSavedConfigsLoading: false });
  }
}

// POSTs the current configuration and returns the created record
// ({id, url, name, savedAt}) — factored out of saveCurrentConfig so Issue
// #209's "Save output" create-and-link flow (createConfigAndSaveOutput
// below) can reuse the exact same POST without also driving
// modal-save-config's own UI side effects (closing that modal, toasting,
// refreshing the list — the create-and-link flow has its own equivalents
// for those, tied to modal-save-output instead).
async function createSavedConfig(bridge, name) {
  const state = bridge.getState();
  // Issue #239: a Combined-mode config has no ad-hoc fields/groups/apiConfig
  // of its own to serialize — each component's full config is resolved live
  // from its own saved configuration instead (see resolveCombinedComponents),
  // so a saved Combined config always reflects each component's current
  // state at save time, not a stale snapshot from whenever it was picked.
  const combinedComponents = state.mode === 'combined'
    ? await resolveCombinedComponents(state.combinedComponents || [])
    : null;
  // Issue-driven follow-up: outputAsJson/includeDataPreview/includeOutputFile/
  // externalConfig moved from per-scrape _state to the cross-session global
  // Settings tab (shared/global-settings.js) — read from there now, same as
  // every other buildScrapingConfig/buildConfigExport call site.
  const globalSettings = getGlobalSettings();
  const config = buildScrapingConfig(
    state.url, state.mode, state.fields, state.groups, state.apiConfig,
    state.scriptFileName, state.outputFileName, state.engine, state.browserActions, globalSettings.includeDataPreview,
    globalSettings.outputAsJson, state.additionalStartUrls, state.changeDetection, state.proxy, state.hardening,
    state.pagination, state.persistentSession, false, globalSettings.externalConfig, combinedComponents, state.blocks,
    state.selectedOutputBlueprintId, state.selectedOutputBlueprintFieldNames, state.outputBlueprintMapping,
    state.selectedOutputBlueprintSchemaKind, state.selectedOutputBlueprintTree, state.outputBlueprintTreeMapping,
    state.discoveredUrls, state.preflight,
  );
  const res = await fetch(`${getResolvedCompanionUrl()}/configs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: state.url, name, config }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function saveCurrentConfig(bridge, name) {
  log('SAVE_CONFIG', name);
  try {
    await createSavedConfig(bridge, name);
    log('SAVE_CONFIG OK');
    bridge.patchState({ saveConfigModalOpen: false });
    showToast(t('toast.configSaved'), null, 'info');
    await fetchSavedConfigs(bridge, bridge.getState().url);
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

// Issue #209: when there's no saved configuration for the current site yet,
// "Save output" creates one inline instead of only ever redirecting into
// modal-save-config first — the modal collects both a configuration name and
// an output name in one go (see renderSaveOutputModal/confirmSaveOutput),
// and confirming saves the config first (the same POST /configs
// createSavedConfig already makes for the regular "Save configuration"
// button), then immediately links this run's output to the newly-created
// id via the existing saveCurrentOutput. If the config save succeeds but
// the output save then fails, the configuration is deliberately left in
// place rather than rolled back — saveCurrentOutput already reports that
// failure via its own toast, and "Save output" can simply be retried
// against the now-existing configuration through the normal picker.
async function createConfigAndSaveOutput(bridge, configName, outputName) {
  log('CREATE_CONFIG_AND_SAVE_OUTPUT', configName, outputName);
  let created;
  try {
    created = await createSavedConfig(bridge, configName);
    log('CREATE_CONFIG_AND_SAVE_OUTPUT config OK', created.id);
  } catch (err) {
    log('CREATE_CONFIG_AND_SAVE_OUTPUT config FAIL', err.message);
    showToast(t('toast.configSaveFailed', { message: err.message }), 'Save configuration');
    return;
  }
  await fetchSavedConfigs(bridge, bridge.getState().url);
  await saveCurrentOutput(bridge, created.id, outputName);
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

// Issue #207: kicks off "Test hardening" for one specific saved output —
// sends whatever's currently configured live in _state.hardening (via
// buildHardeningConfig, the same converter a real /generate request already
// uses), not necessarily what was saved with this output originally, per
// the issue's own "what would today's checks report" framing. A
// BaselineCheck needs a "previous" dataset to compare against, resolved by
// the companion via one of two comparison bases — this only actually asks
// the user to choose when there's a genuine choice to make (a Baseline
// check is live AND this output's own config has a Blueprint set); every
// other case runs immediately.
function startHardeningReplay(bridge, configId, outputId) {
  const state = bridge.getState();
  const checks = buildHardeningConfig(state.hardening);
  if (!checks) {
    showToast(t('idle.hardeningReplayNoChecks'), null, 'warn');
    return;
  }

  const hasBaseline = checks.some((check) => check.kind === 'baseline');
  const configEntry = (state.savedConfigs || []).find((c) => c.id === configId);
  const needsCompareBasisChoice = hasBaseline && !!configEntry?.blueprintId;

  log('BTN saved-output-replay-hardening', { configId, outputId, needsCompareBasisChoice });
  bridge.patchState({
    hardeningReplay: {
      configId, outputId, checks, compareBasis: 'config',
      needsCompareBasisChoice, loading: false, results: null, error: null,
    },
  });
  if (!needsCompareBasisChoice) runHardeningReplay(bridge);
}

function chooseHardeningReplayCompareBasis(bridge, basis) {
  const replay = bridge.getState().hardeningReplay;
  if (!replay) return;
  bridge.patchState({ hardeningReplay: { ...replay, compareBasis: basis } });
}

async function runHardeningReplay(bridge) {
  const replay = bridge.getState().hardeningReplay;
  if (!replay) return;
  bridge.patchState({ hardeningReplay: { ...replay, needsCompareBasisChoice: false, loading: true, error: null } });

  try {
    const res = await fetch(`${getResolvedCompanionUrl()}/configs/${replay.configId}/outputs/${replay.outputId}/replay-hardening`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checks: replay.checks, compareBasis: replay.compareBasis }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    bridge.patchState({ hardeningReplay: { ...bridge.getState().hardeningReplay, loading: false, results: body.results } });
  } catch (err) {
    log('HARDENING_REPLAY FAIL', err.message);
    bridge.patchState({ hardeningReplay: { ...bridge.getState().hardeningReplay, loading: false, error: err.message } });
  }
}

function cancelHardeningReplay(bridge) {
  bridge.patchState({ hardeningReplay: null });
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

// Issue #202/#209: populates modal-save-output — a config picker + name
// input when there's at least one saved config for the current hostname
// already (_state.savedConfigs, fetched the same way the "Saved
// configurations" panel's own list already is), or an inline
// create-a-new-configuration form otherwise, since an output can't be
// linked to a config that doesn't exist yet — see confirmSaveOutput for how
// btn-save-output-confirm branches between the two on submit.
function renderSaveOutputModal(bridge) {
  const state = bridge.getState();
  const savedConfigs = state.savedConfigs || [];
  const hasConfigs = savedConfigs.length > 0;

  document.getElementById('save-output-picker')?.classList.toggle('hidden', !hasConfigs);
  document.getElementById('save-output-create-config')?.classList.toggle('hidden', hasConfigs);

  if (hasConfigs) {
    const selectEl = document.getElementById('select-save-output-config');
    if (selectEl) {
      selectEl.innerHTML = savedConfigs.map((entry) => {
        const savedDate = new Date(entry.savedAt);
        const savedAtText = Number.isNaN(savedDate.getTime()) ? entry.savedAt : savedDate.toLocaleString();
        return `<option value="${entry.id}">${escapeHtml(entry.name)} (${escapeHtml(savedAtText)})</option>`;
      }).join('');
    }
    return;
  }

  // Issue #209: prefill the inline config-name input with the current
  // page's hostname — the same default openSaveConfigModal's own separate
  // flow already uses.
  const configNameInput = document.getElementById('input-save-output-config-name');
  if (configNameInput) {
    let defaultName = '';
    try {
      defaultName = new URL(state.url).hostname;
    } catch {
      // state.url isn't a well-formed absolute URL — defaultName stays ''
      // and the input is simply left blank, same as openSaveConfigModal.
    }
    configNameInput.value = defaultName;
  }
}

// Issue-driven follow-up: the global Settings tab's own cross-site saved-
// configurations section — the unscoped counterpart to
// renderSavedConfigsList above, browsing/deleting anything saved for *any*
// site (state.allSavedConfigs, already fetched unconditionally by
// checkCompanion() for Combined mode's own component picker — no new fetch
// needed here). No "Laden" action here — loading only makes sense in the
// context of the site currently open in the tracked browser tab (see
// loadSavedConfig's own doc comment on why _state.url is never touched by
// it), which an arbitrary entry in this unscoped list may not even be. Uses
// its own allSavedConfigsPendingDeleteId state slot rather than sharing
// savedConfigsPendingDeleteId with the per-site list, so an in-progress
// delete-confirm on one screen never leaks into the other; the outputs
// sub-panel itself (toggle/download/delete/replay-hardening) is shared
// global state (savedConfigsExpandedId etc.) the same way it already is
// across a single screen's own re-renders — harmless, since only one of
// the IDLE/Settings screens is ever visible at a time.
function renderAllSavedConfigsList(bridge) {
  const state = bridge.getState();
  const listEl = document.getElementById('all-saved-configs-list');
  const emptyEl = document.getElementById('all-saved-configs-empty');
  if (!listEl) return;
  listEl.innerHTML = '';

  const allSavedConfigs = state.allSavedConfigs || [];
  if (emptyEl) emptyEl.classList.toggle('hidden', allSavedConfigs.length > 0);

  allSavedConfigs.forEach((entry) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'saved-config-row';
    const savedDate = new Date(entry.savedAt);
    const savedAtText = Number.isNaN(savedDate.getTime()) ? entry.savedAt : savedDate.toLocaleString();

    if (state.allSavedConfigsPendingDeleteId === entry.id) {
      rowEl.innerHTML =
        `<span class="saved-config-name">${escapeHtml(entry.name)}</span>` +
        `<span class="saved-config-confirm-text">${escapeHtml(t('idle.savedConfigsDeleteConfirm'))}</span>` +
        `<button type="button" class="btn-danger btn-tiny btn-all-saved-config-delete-confirm" data-id="${entry.id}">${escapeHtml(t('idle.savedConfigsDeleteConfirmYes'))}</button>` +
        `<button type="button" class="btn-secondary btn-tiny btn-all-saved-config-delete-cancel" data-id="${entry.id}">${escapeHtml(t('idle.savedConfigsDeleteConfirmNo'))}</button>`;
    } else {
      const outputsExpanded = state.savedConfigsExpandedId === entry.id;
      rowEl.innerHTML =
        `<span class="saved-config-name" title="${escapeHtml(entry.url)}">${escapeHtml(entry.name)}</span>` +
        `<span class="saved-config-date">${escapeHtml(savedAtText)}</span>` +
        `<button type="button" class="btn-secondary btn-tiny btn-saved-config-outputs-toggle" data-id="${entry.id}">${escapeHtml(t(outputsExpanded ? 'idle.savedConfigsOutputsHideBtn' : 'idle.savedConfigsOutputsBtn'))}</button>` +
        `<button type="button" class="btn-danger btn-tiny btn-all-saved-config-delete" data-id="${entry.id}">${escapeHtml(t('idle.savedConfigsDeleteBtn'))}</button>`;
    }
    listEl.appendChild(rowEl);

    if (state.savedConfigsExpandedId === entry.id) {
      listEl.appendChild(buildSavedOutputsPanelEl(bridge, entry.id));
    }
  });
}

function requestDeleteAllSavedConfig(bridge, id) {
  bridge.patchState({ allSavedConfigsPendingDeleteId: id });
}

function cancelDeleteAllSavedConfig(bridge) {
  bridge.patchState({ allSavedConfigsPendingDeleteId: null });
}

// Same DELETE /configs/{id} as deleteSavedConfig above, but refreshes both
// lists afterward — allSavedConfigs (this screen's own list) and, since the
// deleted entry might belong to the site currently open in the tracked tab,
// the per-site savedConfigs list too, so the IDLE screen's own panel isn't
// left showing a now-deleted entry after navigating back to it.
async function deleteAllSavedConfigsEntry(bridge, id) {
  log('DELETE_ALL_SAVED_CONFIGS_ENTRY', id);
  try {
    const res = await fetch(`${getResolvedCompanionUrl()}/configs/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
    log('DELETE_ALL_SAVED_CONFIGS_ENTRY OK');
    bridge.patchState({ allSavedConfigsPendingDeleteId: null });
    showToast(t('toast.configDeleted'), null, 'info');
    await fetchAllSavedConfigs(bridge);
    const url = bridge.getState().url;
    if (url) await fetchSavedConfigs(bridge, url);
  } catch (err) {
    log('DELETE_ALL_SAVED_CONFIGS_ENTRY FAIL', err.message);
    showToast(t('toast.configDeleteFailed', { message: err.message }), 'Delete configuration');
  }
}

// Shared by wireSavedConfigsEvents/wireAllSavedConfigsEvents' own delegated
// listeners below — the outputs sub-panel's own actions (toggle/download/
// delete/replay-hardening) are identical regardless of which list a saved
// config's own row happens to live in, since buildSavedOutputsPanelEl always
// renders the same fixed class names. Returns true once it has handled the
// click (so the caller's own list-specific branches, checked first, still
// take priority).
function handleSavedOutputsSubPanelClick(bridge, e) {
  const outputsToggleBtn = e.target.closest('.btn-saved-config-outputs-toggle');
  if (outputsToggleBtn) {
    toggleSavedConfigOutputs(bridge, parseInt(outputsToggleBtn.dataset.id, 10));
    return true;
  }
  const outputDownloadBtn = e.target.closest('.btn-saved-output-download');
  if (outputDownloadBtn) {
    downloadSavedOutput(
      parseInt(outputDownloadBtn.dataset.configId, 10), parseInt(outputDownloadBtn.dataset.id, 10));
    return true;
  }
  const replayBtn = e.target.closest('.btn-saved-output-replay-hardening');
  if (replayBtn) {
    startHardeningReplay(bridge, parseInt(replayBtn.dataset.configId, 10), parseInt(replayBtn.dataset.id, 10));
    return true;
  }
  const basisBtn = e.target.closest('.btn-hardening-replay-basis');
  if (basisBtn) {
    chooseHardeningReplayCompareBasis(bridge, basisBtn.dataset.basis);
    return true;
  }
  const runBtn = e.target.closest('.btn-hardening-replay-run');
  if (runBtn) {
    runHardeningReplay(bridge);
    return true;
  }
  const replayCancelBtn = e.target.closest('.btn-hardening-replay-cancel');
  if (replayCancelBtn) {
    cancelHardeningReplay(bridge);
    return true;
  }
  const outputDeleteBtn = e.target.closest('.btn-saved-output-delete');
  if (outputDeleteBtn) {
    requestDeleteSavedOutput(bridge, parseInt(outputDeleteBtn.dataset.id, 10));
    return true;
  }
  const outputConfirmBtn = e.target.closest('.btn-saved-output-delete-confirm');
  if (outputConfirmBtn) {
    deleteSavedOutput(
      bridge, parseInt(outputConfirmBtn.dataset.configId, 10), parseInt(outputConfirmBtn.dataset.id, 10));
    return true;
  }
  const outputCancelBtn = e.target.closest('.btn-saved-output-delete-cancel');
  if (outputCancelBtn) {
    cancelDeleteSavedOutput(bridge);
    return true;
  }
  return false;
}

function wireAllSavedConfigsEvents(bridge) {
  document.getElementById('all-saved-configs-list')?.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.btn-all-saved-config-delete');
    if (deleteBtn) {
      requestDeleteAllSavedConfig(bridge, parseInt(deleteBtn.dataset.id, 10));
      return;
    }
    const confirmBtn = e.target.closest('.btn-all-saved-config-delete-confirm');
    if (confirmBtn) {
      deleteAllSavedConfigsEntry(bridge, parseInt(confirmBtn.dataset.id, 10));
      return;
    }
    const cancelBtn = e.target.closest('.btn-all-saved-config-delete-cancel');
    if (cancelBtn) {
      cancelDeleteAllSavedConfig(bridge);
      return;
    }
    handleSavedOutputsSubPanelClick(bridge, e);
  });
}

// Wires every button/input this module's own render functions above put on
// the page — "Save configuration"/"Save output" modal open+confirm+cancel,
// and the saved-configs-list's own delegated Load/Delete/Outputs-toggle/
// download row actions (rows are rebuilt on every render(), see
// renderSavedConfigsList, so delegation on the list container itself is the
// only way to keep listeners attached across re-renders).
function wireSavedConfigsEvents(bridge) {
  // Issue #202/#209: "Save output" (DONE screen) opens modal-save-output —
  // a config picker + name input when there's at least one saved config for
  // this hostname already, or an inline create-a-new-configuration form
  // otherwise (see renderSaveOutputModal, called from render()).
  // confirmSaveOutput branches on the same condition to either link to the
  // picked config or create-and-link a new one; wired to both the confirm
  // button and Enter on either text input, since either form field could be
  // the one focused when the user presses Enter.
  document.getElementById('btn-save-output')?.addEventListener('click', () => {
    log('BTN save-output → open modal');
    bridge.patchState({ saveOutputModalOpen: true });
  });
  document.getElementById('btn-save-output-cancel')?.addEventListener('click', () => {
    log('BTN save-output-cancel');
    bridge.patchState({ saveOutputModalOpen: false });
  });
  function confirmSaveOutput() {
    const outputName = document.getElementById('input-save-output-name')?.value.trim();
    if (!outputName) return;
    const hasConfigs = (bridge.getState().savedConfigs || []).length > 0;
    if (hasConfigs) {
      const configId = parseInt(document.getElementById('select-save-output-config')?.value, 10);
      if (!configId) return;
      log('BTN save-output-confirm', configId, outputName);
      saveCurrentOutput(bridge, configId, outputName);
      return;
    }
    const configName = document.getElementById('input-save-output-config-name')?.value.trim();
    if (!configName) return;
    log('BTN save-output-confirm (create config)', configName, outputName);
    createConfigAndSaveOutput(bridge, configName, outputName);
  }
  document.getElementById('btn-save-output-confirm')?.addEventListener('click', confirmSaveOutput);
  document.getElementById('input-save-output-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmSaveOutput();
  });
  document.getElementById('input-save-output-config-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmSaveOutput();
  });

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
    // also rebuilt on every render() (see renderSavedConfigsList). Shared
    // with renderAllSavedConfigsList's own delegated listener above, since
    // buildSavedOutputsPanelEl's own markup is identical either way.
    handleSavedOutputsSubPanelClick(bridge, e);
  });
}

  return {renderSavedConfigsList, buildSavedOutputsPanelEl,
    wireSavedConfigsEvents,
    fetchSavedConfigs, fetchAllSavedConfigs, createSavedConfig, saveCurrentConfig, loadSavedConfig,
    requestDeleteSavedConfig, cancelDeleteSavedConfig, deleteSavedConfig,
    openSaveConfigModal,
    saveCurrentOutput, createConfigAndSaveOutput, fetchSavedOutputs, toggleSavedConfigOutputs, downloadSavedOutput,
    requestDeleteSavedOutput, cancelDeleteSavedOutput, deleteSavedOutput,
    renderSaveOutputModal,
    startHardeningReplay, chooseHardeningReplayCompareBasis, runHardeningReplay, cancelHardeningReplay,
    buildHardeningReplayPanelEl,
    renderAllSavedConfigsList, wireAllSavedConfigsEvents,
    requestDeleteAllSavedConfig, cancelDeleteAllSavedConfig, deleteAllSavedConfigsEntry,};
})();

if (typeof module !== 'undefined') module.exports = SFSavedConfigsUI;
if (typeof self !== 'undefined') self.SFSavedConfigsUI = SFSavedConfigsUI;
