// ── Idle screen: mode switch + top-level chrome render / wiring ──
// The STATES.IDLE render block and its widgets (mode toggle, robots.txt check, preview / API-capture toggles, output-settings
// filename inputs). Functions take a `bridge` instead of closing over popup.ts state.
import type { Mode, PopupBridge, StatePatch } from '../types/popup';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import { countApiConfigFields } from './api-config';
import { reopenableDraft } from './api-config-reopen';
import { renderApiEntriesList, renderApiCandidates, toggleApiCapture } from './api-config-ui';
import { renderGroupTree } from './container-tree-ui';
import { renderFields } from './flat-mode-ui';
import { renderBrowserActionsSection } from './browser-actions-ui';
import { parseAdditionalUrls } from './scraping-config-builder';
import { renderSettingsPanel } from './settings-panel-ui';
import { renderPaginationHelpers } from './pagination-ui';
import { renderDedupSection } from './dedup-config-ui';
import { renderRequestHeadersSection } from './request-headers-ui';
import { renderSavedConfigsList, fetchAllSavedConfigs } from './saved-configs-ui';
import { checkRobotsTxt } from './companion-client';
import { togglePreview } from './preview';
import { renderCombinedSection } from './combined-config-ui';
import { renderBlocksSection } from './blocks-config-ui';
import { mappingIsComplete, treeMappingIsComplete } from './output-blueprints';
import { renderOutputBlueprintMappingSection } from './output-blueprints-ui';
import { getGlobalSettings } from '../shared/global-settings';
import { byIdOrNull } from './dom';

const log = createLogger('SF:Popup');

function show(id: string): void { byIdOrNull(id)?.classList.remove('hidden'); }

// Modes are strictly separate: switching clears the other modes' configuration. apiConfigDraft is cleared defensively too
// (unreachable today). Switching to or from 'blocks' also resets its draft and confirmed list: a half-built block means nothing
// in another mode.
const BLOCKS_DRAFT_RESET: StatePatch = {
  blocks: [], blocksDraftShape: 'flat', blocksDraftName: '', blocksDraftOutputFileName: '', blocksEditingIndex: null,
};

// A blueprint mapping's source-field names only mean something in the mode that built it, so every mode switch clears it.
const OUTPUT_BLUEPRINT_RESET: StatePatch = {
  selectedOutputBlueprintId: '', selectedOutputBlueprintFieldNames: [], outputBlueprintMapping: {},
  // Issue #244: the tree-shaped mapping's own equivalent state, cleared
  // alongside the flat one for the exact same reason.
  selectedOutputBlueprintSchemaKind: 'Flat', selectedOutputBlueprintTree: [], outputBlueprintTreeMapping: {},
};

// A Record over every mode: a new mode is a compile error until its row is added here.
const MODE_SWITCH_CLEARS: Record<Mode, StatePatch> = {
  flat:      { groups: [], apiConfig: null, apiConfigApplied: null, apiConfigDraft: null, combinedComponents: [], ...BLOCKS_DRAFT_RESET, ...OUTPUT_BLUEPRINT_RESET },
  container: { fields: [], apiConfig: null, apiConfigApplied: null, apiConfigDraft: null, combinedComponents: [], ...BLOCKS_DRAFT_RESET, ...OUTPUT_BLUEPRINT_RESET },
  api:       { fields: [], groups: [], combinedComponents: [], ...BLOCKS_DRAFT_RESET, ...OUTPUT_BLUEPRINT_RESET },
  combined:  { fields: [], groups: [], apiConfig: null, apiConfigApplied: null, apiConfigDraft: null, ...BLOCKS_DRAFT_RESET, ...OUTPUT_BLUEPRINT_RESET },
  blocks:    { fields: [], groups: [], apiConfig: null, apiConfigApplied: null, apiConfigDraft: null, combinedComponents: [], ...BLOCKS_DRAFT_RESET },
};

export function switchMode(bridge: PopupBridge, mode: Mode): void {
  const state = bridge.getState();
  if (mode === state.mode) return;
  log('MODE_SWITCH', mode);
  bridge.stopPreviewIfActive();
  bridge.setState(state.current, { mode, ...MODE_SWITCH_CLEARS[mode] });
  // Fetched once on entering Combined mode; the picker list may go slightly stale if a config is saved elsewhere meanwhile
  // (same tradeoff as fetchSavedConfigs).
  if (mode === 'combined') fetchAllSavedConfigs(bridge);
}

// Called from popup.ts's render() only while _state.current === STATES.IDLE.
export function renderIdleScreen(bridge: PopupBridge): void {
  const state = bridge.getState();

  const urlEl = byIdOrNull('url-display');
  if (urlEl) urlEl.textContent = state.url || '—';

  const robotsBtn = byIdOrNull<HTMLButtonElement>('btn-check-robots');
  if (robotsBtn) {
    robotsBtn.disabled = state.robotsTxtChecking;
    robotsBtn.textContent = t(state.robotsTxtChecking ? 'idle.robotsCheckBtnChecking' : 'idle.robotsCheckBtn');
  }
  const robotsResultEl = byIdOrNull('robots-txt-result');
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
      robotsResultEl.textContent = t('robots.disallowed', { path: r.path, pattern: (r.matchedRule as { pattern: string }).pattern }); // a disallowed path always names its rule
      robotsResultEl.className = 'robots-txt-result robots-txt-disallowed';
    }
  }

  byIdOrNull('btn-mode-flat')?.classList.toggle('active', state.mode === 'flat');
  byIdOrNull('btn-mode-container')?.classList.toggle('active', state.mode === 'container');
  byIdOrNull('btn-mode-api')?.classList.toggle('active', state.mode === 'api');
  byIdOrNull('btn-mode-combined')?.classList.toggle('active', state.mode === 'combined');
  byIdOrNull('btn-mode-blocks')?.classList.toggle('active', state.mode === 'blocks');
  // Blocks mode reuses the flat / container sections as its block draft editor: shown when the matching top-level mode is active,
  // or Blocks is active and its draft shape picks that shape.
  const isBlocksFlatDraft = state.mode === 'blocks' && state.blocksDraftShape === 'flat';
  const isBlocksGroupDraft = state.mode === 'blocks' && state.blocksDraftShape === 'group';
  byIdOrNull('flat-mode-section')?.classList.toggle('hidden', !(state.mode === 'flat' || isBlocksFlatDraft));
  byIdOrNull('container-mode-section')?.classList.toggle('hidden', !(state.mode === 'container' || isBlocksGroupDraft));
  byIdOrNull('api-mode-section')?.classList.toggle('hidden', state.mode !== 'api');
  byIdOrNull('combined-mode-section')?.classList.toggle('hidden', state.mode !== 'combined');
  byIdOrNull('blocks-mode-section')?.classList.toggle('hidden', state.mode !== 'blocks');
  // "Show preview" highlights DOM matches: meaningless for API and Combined mode; Blocks keeps it (the draft's fields / groups).
  byIdOrNull('preview-section')?.classList.toggle('hidden', state.mode === 'api' || state.mode === 'combined');
  // Engine / browser actions are component-level in Combined mode (the companion rejects them on the outer request); Blocks keeps
  // the section, since they are shared at the outer level there.
  byIdOrNull('engine-section')?.classList.toggle('hidden', state.mode === 'combined');

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
  byIdOrNull('btn-add-combine-field')?.classList.toggle('hidden', combineSplitActionsHidden);
  byIdOrNull('btn-add-split-field')?.classList.toggle('hidden', combineSplitActionsHidden);
  const combineFieldBtn = byIdOrNull<HTMLButtonElement>('btn-add-combine-field');
  if (combineFieldBtn) combineFieldBtn.disabled = (state.fields || []).length < 2;
  const splitFieldBtn = byIdOrNull<HTMLButtonElement>('btn-add-split-field');
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
      ? !treeMappingIsComplete(state.selectedOutputBlueprintTree, state.outputBlueprintTreeMapping ?? {})
      : !mappingIsComplete(state.selectedOutputBlueprintFieldNames, state.outputBlueprintMapping));
  byIdOrNull('output-blueprint-toggle-row')?.classList.toggle('hidden', !outputBlueprintEligibleMode);
  if (outputBlueprintEligibleMode) renderOutputBlueprintMappingSection(bridge);
  else byIdOrNull('output-blueprint-mapping')?.classList.add('hidden');
  const genBtn = byIdOrNull<HTMLButtonElement>('btn-generate');
  if (genBtn) genBtn.disabled = !hasConfig || blueprintMappingIncomplete;
  const exportBtn = byIdOrNull<HTMLButtonElement>('btn-export-config');
  if (exportBtn) exportBtn.disabled = !hasConfig;
  const saveConfigBtn = byIdOrNull<HTMLButtonElement>('btn-save-config');
  if (saveConfigBtn) saveConfigBtn.disabled = !hasConfig;

  const previewBtn = byIdOrNull<HTMLButtonElement>('btn-preview');
  if (previewBtn) {
    previewBtn.disabled = !hasConfig;
    previewBtn.classList.toggle('active', state.previewActive);
    previewBtn.textContent = t(state.previewActive ? 'idle.previewHideBtn' : 'idle.previewShowBtn');
  }
  const previewSummaryEl = byIdOrNull('preview-summary');
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

  const apiCaptureBtn = byIdOrNull('btn-api-capture');
  if (apiCaptureBtn) {
    apiCaptureBtn.classList.toggle('active', state.apiCaptureActive);
    apiCaptureBtn.textContent = t(state.apiCaptureActive ? 'idle.apiCaptureStopBtn' : 'idle.apiCaptureStartBtn');
  }
  const apiCaptureSummaryEl = byIdOrNull('api-capture-summary');
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

  const apiSearchBtn = byIdOrNull<HTMLButtonElement>('btn-api-search');
  if (apiSearchBtn) apiSearchBtn.disabled = state.apiCaptureCount === 0;

  const apiEntriesToggleBtn = byIdOrNull<HTMLButtonElement>('btn-api-entries-toggle');
  if (apiEntriesToggleBtn) {
    apiEntriesToggleBtn.disabled = state.apiCaptureCount === 0;
    apiEntriesToggleBtn.textContent = state.apiEntriesPanelOpen
      ? t('idle.apiEntriesHideBtn')
      : t('idle.apiEntriesShowBtn', { count: state.apiCaptureCount });
  }
  const apiEntriesPanel = byIdOrNull('api-entries-panel');
  if (apiEntriesPanel) {
    if (state.apiEntriesPanelOpen) {
      renderApiEntriesList(state.apiEntries);
      apiEntriesPanel.classList.remove('hidden');
    } else {
      apiEntriesPanel.classList.add('hidden');
    }
  }

  const apiCandidatesPanel = byIdOrNull('api-candidates-panel');
  if (apiCandidatesPanel) {
    if (state.apiCandidates) {
      renderApiCandidates(state.apiCandidates);
      apiCandidatesPanel.classList.remove('hidden');
    } else {
      apiCandidatesPanel.classList.add('hidden');
    }
  }

  const apiConfigPanel = byIdOrNull('api-config-panel');
  if (apiConfigPanel) {
    if (state.apiConfig) {
      const summaryEl = byIdOrNull('api-config-summary');
      if (summaryEl) {
        const { parameters, headers } = state.apiConfig;
        summaryEl.textContent = t('idle.apiConfigSummary', {
          fields: countApiConfigFields(state.apiConfig),
          parameters: parameters.length,
          headers: headers ? t('idle.apiConfigSummaryHeaders', { count: headers.length }) : '',
        });
      }
      const reopenable = !!reopenableDraft(state);
      byIdOrNull('btn-api-config-edit')?.classList.toggle('hidden', !reopenable);
      byIdOrNull('api-config-not-editable')?.classList.toggle('hidden', reopenable);
      apiConfigPanel.classList.remove('hidden');
    } else {
      apiConfigPanel.classList.add('hidden');
    }
  }

  // Only overwrite an input's value while it isn't the one the user is
  // currently typing in — otherwise every keystroke's setState()/render()
  // round-trip would reset the cursor to the end of the field.
  const scriptNameInput = byIdOrNull<HTMLInputElement>('input-script-filename');
  if (scriptNameInput && document.activeElement !== scriptNameInput) scriptNameInput.value = state.scriptFileName;
  const outputNameInput = byIdOrNull<HTMLInputElement>('input-output-filename');
  if (outputNameInput && document.activeElement !== outputNameInput) outputNameInput.value = state.outputFileName;
  // Issue #182: no single output file to name for Blocks mode — each
  // block names its own (see #blocks-mode-section's own input).
  byIdOrNull('output-filename-row')?.classList.toggle('hidden', state.mode === 'blocks');
  // The default extension follows the shape (container Xml; API tree Xml, API flat Csv, like flat mode); the global JSON
  // preference (shared/global-settings.ts) overrides it.
  const isTreeShapedMode = state.mode === 'container'
    || (state.mode === 'api' && !!state.apiConfig?.groups?.length);
  const outputExtEl = byIdOrNull('output-filename-ext');
  if (outputExtEl) {
    const chosenFormat = getGlobalSettings().outputFormat;
    const tableFormat = chosenFormat === 'sqlite' || chosenFormat === 'xlsx';
    outputExtEl.textContent = chosenFormat === 'json' ? '.json'
      : tableFormat ? `.${chosenFormat}` : (isTreeShapedMode ? '.xml' : '.csv');
    // Issue #229: a nested result written as a table is flattened.
    byIdOrNull('output-format-hint')?.classList.toggle('hidden', !(tableFormat && isTreeShapedMode));
  }

  // Issue #83: hidden for API mode — Api builds its own request URL from
  // apiConfig.urlTemplate and never reads this list at all (the companion
  // rejects the combination outright, see GenerateEndpoint.cs).
  byIdOrNull('additional-urls-row')?.classList.toggle('hidden', state.mode === 'api' || state.mode === 'combined');
  const additionalUrlsInput = byIdOrNull<HTMLTextAreaElement>('input-additional-urls');
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
    const nameInput = byIdOrNull<HTMLInputElement>('input-container-name');
    if (nameInput) { nameInput.value = ''; nameInput.focus(); }
    const singleRadio = byIdOrNull<HTMLInputElement>('radio-container-single');
    if (singleRadio) singleRadio.checked = true;
  }
}

export function wireIdleScreenEvents(bridge: PopupBridge): void {
  byIdOrNull('btn-mode-flat')?.addEventListener('click', () => switchMode(bridge, 'flat'));
  byIdOrNull('btn-mode-container')?.addEventListener('click', () => switchMode(bridge, 'container'));
  byIdOrNull('btn-mode-api')?.addEventListener('click', () => switchMode(bridge, 'api'));
  byIdOrNull('btn-mode-combined')?.addEventListener('click', () => switchMode(bridge, 'combined'));
  byIdOrNull('btn-mode-blocks')?.addEventListener('click', () => switchMode(bridge, 'blocks'));

  byIdOrNull('btn-preview')?.addEventListener('click', () => {
    log('BTN preview');
    togglePreview(bridge);
  });

  byIdOrNull('btn-check-robots')?.addEventListener('click', () => {
    log('BTN check-robots');
    checkRobotsTxt(bridge);
  });

  byIdOrNull('btn-api-capture')?.addEventListener('click', () => {
    log('BTN api-capture');
    toggleApiCapture(bridge);
  });

  byIdOrNull('input-script-filename')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, { scriptFileName: (e.target as HTMLInputElement).value });
  });
  byIdOrNull('input-output-filename')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, { outputFileName: (e.target as HTMLInputElement).value });
  });
  byIdOrNull('input-additional-urls')?.addEventListener('input', (e) => {
    bridge.setState(bridge.getState().current, { additionalStartUrls: parseAdditionalUrls((e.target as HTMLTextAreaElement).value) });
  });
}
