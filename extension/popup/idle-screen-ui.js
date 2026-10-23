// ── Idle screen: mode switch + top-level chrome render / wiring ──
// The STATES.IDLE render block and its widgets (mode toggle, robots.txt check, preview / API-capture toggles, output-settings
// filename inputs). Functions take a `bridge` instead of closing over popup.js state.
const { createLogger } = require('../shared/logger');
const log = createLogger('SF:Popup');
const { t } = require('../i18n/i18n');
const { countApiConfigFields } = require('./api-config');
const { renderApiEntriesList, renderApiCandidates, toggleApiCapture } = require('./api-config-ui');
const { renderGroupTree } = require('./container-tree-ui');
const { renderFields } = require('./flat-mode-ui');
const { renderBrowserActionsSection } = require('./browser-actions-ui');
const { parseAdditionalUrls } = require('./scraping-config-builder');
const { renderSettingsPanel } = require('./settings-panel-ui');
const { renderPaginationHelpers } = require('./pagination-ui');
const { renderDedupSection } = require('./dedup-config-ui');
const { renderRequestHeadersSection } = require('./request-headers-ui');
const { renderSavedConfigsList, fetchAllSavedConfigs } = require('./saved-configs-ui');
const { checkRobotsTxt } = require('./companion-client');
const { togglePreview } = require('./preview');
const { renderCombinedSection } = require('./combined-config-ui');
const { renderBlocksSection } = require('./blocks-config-ui');
const { mappingIsComplete, treeMappingIsComplete } = require('./output-blueprints');
const { renderOutputBlueprintMappingSection } = require('./output-blueprints-ui');
const { getGlobalSettings } = require('../shared/global-settings');

// Duplicated verbatim from popup.js's own tiny show(id) helper — same "no
// cross-module includes for small DOM helpers" convention already used
// for renderMatchCountHint (see CLAUDE.md).
function show(id) { document.getElementById(id)?.classList.remove('hidden'); }

// Modes are strictly separate: switching clears the other modes' configuration. apiConfigDraft is cleared defensively too
// (unreachable today). Switching to or from 'blocks' also resets its draft and confirmed list: a half-built block means nothing
// in another mode.
const BLOCKS_DRAFT_RESET = {
  blocks: [], blocksDraftShape: 'flat', blocksDraftName: '', blocksDraftOutputFileName: '', blocksEditingIndex: null,
};

// A blueprint mapping's source-field names only mean something in the mode that built it, so every mode switch clears it.
const OUTPUT_BLUEPRINT_RESET = {
  selectedOutputBlueprintId: '', selectedOutputBlueprintFieldNames: [], outputBlueprintMapping: {},
  // Issue #244: the tree-shaped mapping's own equivalent state, cleared
  // alongside the flat one for the exact same reason.
  selectedOutputBlueprintSchemaKind: 'Flat', selectedOutputBlueprintTree: [], outputBlueprintTreeMapping: {},
};

const MODE_SWITCH_CLEARS = {
  flat:      { groups: [], apiConfig: null, apiConfigDraft: null, combinedComponents: [], ...BLOCKS_DRAFT_RESET, ...OUTPUT_BLUEPRINT_RESET },
  container: { fields: [], apiConfig: null, apiConfigDraft: null, combinedComponents: [], ...BLOCKS_DRAFT_RESET, ...OUTPUT_BLUEPRINT_RESET },
  api:       { fields: [], groups: [], combinedComponents: [], ...BLOCKS_DRAFT_RESET, ...OUTPUT_BLUEPRINT_RESET },
  combined:  { fields: [], groups: [], apiConfig: null, apiConfigDraft: null, ...BLOCKS_DRAFT_RESET, ...OUTPUT_BLUEPRINT_RESET },
  blocks:    { fields: [], groups: [], apiConfig: null, apiConfigDraft: null, combinedComponents: [], ...BLOCKS_DRAFT_RESET },
};

function switchMode(bridge, mode) {
  const state = bridge.getState();
  if (mode === state.mode) return;
  log('MODE_SWITCH', mode);
  bridge.stopPreviewIfActive();
  bridge.setState(state.current, { mode, ...MODE_SWITCH_CLEARS[mode] });
  // Fetched once on entering Combined mode; the picker list may go slightly stale if a config is saved elsewhere meanwhile
  // (same tradeoff as fetchSavedConfigs).
  if (mode === 'combined') fetchAllSavedConfigs(bridge);
}

// Called from popup.js's render() only while _state.current === STATES.IDLE.
function renderIdleScreen(bridge) {
  const state = bridge.getState();

  const urlEl = document.getElementById('url-display');
  if (urlEl) urlEl.textContent = state.url || '—';

  const robotsBtn = document.getElementById('btn-check-robots');
  if (robotsBtn) {
    robotsBtn.disabled = state.robotsTxtChecking;
    robotsBtn.textContent = t(state.robotsTxtChecking ? 'idle.robotsCheckBtnChecking' : 'idle.robotsCheckBtn');
  }
  const robotsResultEl = document.getElementById('robots-txt-result');
  if (robotsResultEl) {
    const r = state.robotsTxtResult;
    if (!r) {
      robotsResultEl.className = 'robots-txt-result hidden';
    } else if (!r.ok) {
      robotsResultEl.textContent = t('robots.checkFailed', { error: r.error });
      robotsResultEl.className = 'robots-txt-result robots-txt-unknown';
    } else if (r.notFound) {
      robotsResultEl.textContent = t('robots.notFound');
      robotsResultEl.className = 'robots-txt-result robots-txt-allowed';
    } else if (r.allowed) {
      robotsResultEl.textContent = r.matchedRule
        ? t('robots.allowedWithRule', { path: r.path, pattern: r.matchedRule.pattern })
        : t('robots.allowed', { path: r.path });
      robotsResultEl.className = 'robots-txt-result robots-txt-allowed';
    } else {
      robotsResultEl.textContent = t('robots.disallowed', { path: r.path, pattern: r.matchedRule.pattern });
      robotsResultEl.className = 'robots-txt-result robots-txt-disallowed';
    }
  }

  document.getElementById('btn-mode-flat')?.classList.toggle('active', state.mode === 'flat');
  document.getElementById('btn-mode-container')?.classList.toggle('active', state.mode === 'container');
  document.getElementById('btn-mode-api')?.classList.toggle('active', state.mode === 'api');
  document.getElementById('btn-mode-combined')?.classList.toggle('active', state.mode === 'combined');
  document.getElementById('btn-mode-blocks')?.classList.toggle('active', state.mode === 'blocks');
  // Blocks mode reuses the flat / container sections as its block draft editor: shown when the matching top-level mode is active,
  // or Blocks is active and its draft shape picks that shape.
  const isBlocksFlatDraft = state.mode === 'blocks' && state.blocksDraftShape === 'flat';
  const isBlocksGroupDraft = state.mode === 'blocks' && state.blocksDraftShape === 'group';
  document.getElementById('flat-mode-section')?.classList.toggle('hidden', !(state.mode === 'flat' || isBlocksFlatDraft));
  document.getElementById('container-mode-section')?.classList.toggle('hidden', !(state.mode === 'container' || isBlocksGroupDraft));
  document.getElementById('api-mode-section')?.classList.toggle('hidden', state.mode !== 'api');
  document.getElementById('combined-mode-section')?.classList.toggle('hidden', state.mode !== 'combined');
  document.getElementById('blocks-mode-section')?.classList.toggle('hidden', state.mode !== 'blocks');
  // "Show preview" highlights DOM matches: meaningless for API and Combined mode; Blocks keeps it (the draft's fields / groups).
  document.getElementById('preview-section')?.classList.toggle('hidden', state.mode === 'api' || state.mode === 'combined');
  // Engine / browser actions are component-level in Combined mode (the companion rejects them on the outer request); Blocks keeps
  // the section, since they are shared at the outer level there.
  document.getElementById('engine-section')?.classList.toggle('hidden', state.mode === 'combined');

  // Engine + browser actions (Issue #41/#42, Phase 5) — mode-independent,
  // so this sits alongside the mode toggle above rather than inside any
  // of the three mode-specific blocks.
  renderBrowserActionsSection(bridge);

  if (state.mode === 'container' || isBlocksGroupDraft) {
    renderGroupTree(state.groups);
  } else if (state.mode === 'combined') {
    renderCombinedSection(bridge);
  } else {
    renderFields(state.fields);
  }

  if (state.mode === 'blocks') renderBlocksSection(bridge);

  // The combine / split buttons are excluded from Blocks mode (its templates do not handle derived fields). Disabled, not hidden,
  // below the needed field count: a real click-picked field has to exist first.
  const combineSplitActionsHidden = state.mode === 'blocks';
  document.getElementById('btn-add-combine-field')?.classList.toggle('hidden', combineSplitActionsHidden);
  document.getElementById('btn-add-split-field')?.classList.toggle('hidden', combineSplitActionsHidden);
  const combineFieldBtn = document.getElementById('btn-add-combine-field');
  if (combineFieldBtn) combineFieldBtn.disabled = (state.fields || []).length < 2;
  const splitFieldBtn = document.getElementById('btn-add-split-field');
  if (splitFieldBtn) splitFieldBtn.disabled = (state.fields || []).length < 1;

  const hasConfig = state.mode === 'container' ? state.groups.length > 0
    : state.mode === 'api' ? !!state.apiConfig
    : state.mode === 'combined' ? (state.combinedComponents || []).length >= 2
    : state.mode === 'blocks' ? (state.blocks || []).length >= 2
    : state.fields.length > 0;
  // Reachable for flat, container and both API shapes; hidden for Combined / Blocks, which have no single config to map. A
  // blueprint picked but not fully mapped blocks "Generate" only (not Export / Save / Preview).
  const outputBlueprintEligibleMode = state.mode === 'flat' || state.mode === 'container' || state.mode === 'api';
  // Issue #244: a Tree-schema mapping additionally needs the "completeness"
  // check to walk the fetched target tree instead of the flat field list.
  const blueprintMappingIncomplete = outputBlueprintEligibleMode && !!state.selectedOutputBlueprintId
    && (state.selectedOutputBlueprintSchemaKind === 'Tree'
      ? !treeMappingIsComplete(state.selectedOutputBlueprintTree, state.outputBlueprintTreeMapping)
      : !mappingIsComplete(state.selectedOutputBlueprintFieldNames, state.outputBlueprintMapping));
  document.getElementById('output-blueprint-toggle-row')?.classList.toggle('hidden', !outputBlueprintEligibleMode);
  if (outputBlueprintEligibleMode) renderOutputBlueprintMappingSection(bridge);
  else document.getElementById('output-blueprint-mapping')?.classList.add('hidden');
  const genBtn = document.getElementById('btn-generate');
  if (genBtn) genBtn.disabled = !hasConfig || blueprintMappingIncomplete;
  const exportBtn = document.getElementById('btn-export-config');
  if (exportBtn) exportBtn.disabled = !hasConfig;
  const saveConfigBtn = document.getElementById('btn-save-config');
  if (saveConfigBtn) saveConfigBtn.disabled = !hasConfig;

  const previewBtn = document.getElementById('btn-preview');
  if (previewBtn) {
    previewBtn.disabled = !hasConfig;
    previewBtn.classList.toggle('active', state.previewActive);
    previewBtn.textContent = t(state.previewActive ? 'idle.previewHideBtn' : 'idle.previewShowBtn');
  }
  const previewSummaryEl = document.getElementById('preview-summary');
  if (previewSummaryEl) {
    if (state.previewActive && state.previewSummary) {
      const { total, empty, truncated } = state.previewSummary;
      const parts = [t('idle.previewSummaryMatched', { count: total })];
      if (empty.length > 0) parts.push(t('idle.previewSummaryEmpty', { names: empty.join(', ') }));
      if (truncated) parts.push(t('idle.previewSummaryTruncated'));
      previewSummaryEl.textContent = parts.join(' — ');
      previewSummaryEl.classList.toggle('warn', empty.length > 0);
      previewSummaryEl.classList.remove('hidden');
    } else {
      previewSummaryEl.classList.add('hidden');
    }
  }

  const apiCaptureBtn = document.getElementById('btn-api-capture');
  if (apiCaptureBtn) {
    apiCaptureBtn.classList.toggle('active', state.apiCaptureActive);
    apiCaptureBtn.textContent = t(state.apiCaptureActive ? 'idle.apiCaptureStopBtn' : 'idle.apiCaptureStartBtn');
  }
  const apiCaptureSummaryEl = document.getElementById('api-capture-summary');
  if (apiCaptureSummaryEl) {
    // Shown whenever there's something recorded, not just while active —
    // Phase 4's search below runs *after* the user stops recording, so
    // this is the user's only confirmation that there's something to search.
    if (state.apiCaptureCount > 0) {
      apiCaptureSummaryEl.textContent = t('idle.apiCaptureSummary', { count: state.apiCaptureCount });
      apiCaptureSummaryEl.classList.remove('hidden');
    } else {
      apiCaptureSummaryEl.classList.add('hidden');
    }
  }

  const apiSearchBtn = document.getElementById('btn-api-search');
  if (apiSearchBtn) apiSearchBtn.disabled = state.apiCaptureCount === 0;

  const apiEntriesToggleBtn = document.getElementById('btn-api-entries-toggle');
  if (apiEntriesToggleBtn) {
    apiEntriesToggleBtn.disabled = state.apiCaptureCount === 0;
    apiEntriesToggleBtn.textContent = state.apiEntriesPanelOpen
      ? t('idle.apiEntriesHideBtn')
      : t('idle.apiEntriesShowBtn', { count: state.apiCaptureCount });
  }
  const apiEntriesPanel = document.getElementById('api-entries-panel');
  if (apiEntriesPanel) {
    if (state.apiEntriesPanelOpen) {
      renderApiEntriesList(state.apiEntries);
      apiEntriesPanel.classList.remove('hidden');
    } else {
      apiEntriesPanel.classList.add('hidden');
    }
  }

  const apiCandidatesPanel = document.getElementById('api-candidates-panel');
  if (apiCandidatesPanel) {
    if (state.apiCandidates) {
      renderApiCandidates(state.apiCandidates);
      apiCandidatesPanel.classList.remove('hidden');
    } else {
      apiCandidatesPanel.classList.add('hidden');
    }
  }

  const apiConfigPanel = document.getElementById('api-config-panel');
  if (apiConfigPanel) {
    if (state.apiConfig) {
      const summaryEl = document.getElementById('api-config-summary');
      if (summaryEl) {
        const { parameters, headers } = state.apiConfig;
        summaryEl.textContent = t('idle.apiConfigSummary', {
          fields: countApiConfigFields(state.apiConfig),
          parameters: parameters.length,
          headers: headers ? t('idle.apiConfigSummaryHeaders', { count: headers.length }) : '',
        });
      }
      apiConfigPanel.classList.remove('hidden');
    } else {
      apiConfigPanel.classList.add('hidden');
    }
  }

  // Only overwrite an input's value while it isn't the one the user is
  // currently typing in — otherwise every keystroke's setState()/render()
  // round-trip would reset the cursor to the end of the field.
  const scriptNameInput = document.getElementById('input-script-filename');
  if (scriptNameInput && document.activeElement !== scriptNameInput) scriptNameInput.value = state.scriptFileName;
  const outputNameInput = document.getElementById('input-output-filename');
  if (outputNameInput && document.activeElement !== outputNameInput) outputNameInput.value = state.outputFileName;
  // Issue #182: no single output file to name for Blocks mode — each
  // block names its own (see #blocks-mode-section's own input).
  document.getElementById('output-filename-row')?.classList.toggle('hidden', state.mode === 'blocks');
  // The default extension follows the shape (container Xml; API tree Xml, API flat Csv, like flat mode); the global JSON
  // preference (shared/global-settings.js) overrides it.
  const isTreeShapedMode = state.mode === 'container'
    || (state.mode === 'api' && !!state.apiConfig?.groups?.length);
  const outputExtEl = document.getElementById('output-filename-ext');
  if (outputExtEl) {
    const chosenFormat = getGlobalSettings().outputFormat;
    const tableFormat = chosenFormat === 'sqlite' || chosenFormat === 'xlsx';
    outputExtEl.textContent = chosenFormat === 'json' ? '.json'
      : tableFormat ? `.${chosenFormat}` : (isTreeShapedMode ? '.xml' : '.csv');
    // Issue #229: a nested result written as a table is flattened.
    document.getElementById('output-format-hint')?.classList.toggle('hidden', !(tableFormat && isTreeShapedMode));
  }

  // Issue #83: hidden for API mode — Api builds its own request URL from
  // apiConfig.urlTemplate and never reads this list at all (the companion
  // rejects the combination outright, see Program.cs).
  document.getElementById('additional-urls-row')?.classList.toggle('hidden', state.mode === 'api' || state.mode === 'combined');
  const additionalUrlsInput = document.getElementById('input-additional-urls');
  if (additionalUrlsInput && document.activeElement !== additionalUrlsInput) {
    additionalUrlsInput.value = state.additionalStartUrls.join('\n');
  }

  renderSettingsPanel(bridge);
  renderPaginationHelpers(bridge);
  renderDedupSection(bridge);
  renderRequestHeadersSection(bridge);

  // The saved-configurations list is scoped to the page's hostname (fetchSavedConfigs) and rendered on every pass, so a pending
  // delete confirmation re-renders correctly.
  renderSavedConfigsList(bridge);

  if (state.containerModalOpen) {
    show('modal-container-new');
    const nameInput = document.getElementById('input-container-name');
    if (nameInput) { nameInput.value = ''; nameInput.focus(); }
    const singleRadio = document.getElementById('radio-container-single');
    if (singleRadio) singleRadio.checked = true;
  }
}

function wireIdleScreenEvents(bridge) {
  document.getElementById('btn-mode-flat')?.addEventListener('click', () => switchMode(bridge, 'flat'));
  document.getElementById('btn-mode-container')?.addEventListener('click', () => switchMode(bridge, 'container'));
  document.getElementById('btn-mode-api')?.addEventListener('click', () => switchMode(bridge, 'api'));
  document.getElementById('btn-mode-combined')?.addEventListener('click', () => switchMode(bridge, 'combined'));
  document.getElementById('btn-mode-blocks')?.addEventListener('click', () => switchMode(bridge, 'blocks'));

  document.getElementById('btn-preview')?.addEventListener('click', () => {
    log('BTN preview');
    togglePreview(bridge);
  });

  document.getElementById('btn-check-robots')?.addEventListener('click', () => {
    log('BTN check-robots');
    checkRobotsTxt(bridge);
  });

  document.getElementById('btn-api-capture')?.addEventListener('click', () => {
    log('BTN api-capture');
    toggleApiCapture(bridge);
  });

  document.getElementById('input-script-filename')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, { scriptFileName: e.target.value });
  });
  document.getElementById('input-output-filename')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, { outputFileName: e.target.value });
  });
  document.getElementById('input-additional-urls')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, { additionalStartUrls: parseAdditionalUrls(e.target.value) });
  });
}

module.exports = {
  switchMode, renderIdleScreen, wireIdleScreenEvents,
};

