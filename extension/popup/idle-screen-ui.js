// ── Idle screen: mode switch + top-level chrome render/wiring ───────────────
// Extracted from popup.js (see CLAUDE.md's "Popup module boundaries"
// architecture decision) — the STATES.IDLE render block and its own
// top-level widgets (mode toggle, robots.txt check, preview/API-capture
// toggles, output-settings filename inputs) were the largest remaining
// chunk of popup.js's render()/wireEvents() not yet claimed by any feature
// module. Functions take a `bridge` object (same convention as every other
// extracted module) instead of closing over popup.js's own module-level
// state.
const SFIdleScreenUI = (function () {
  const { createLogger } = typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
  const log = createLogger('SF:Popup');
  const { t } = typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;
  const { countApiConfigFields } = typeof require !== 'undefined' ? require('./api-config') : self.SFApiConfig;
  const { renderApiEntriesList, renderApiCandidates, toggleApiCapture } =
    typeof require !== 'undefined' ? require('./api-config-ui') : self.SFApiConfigUI;
  const { renderGroupTree } = typeof require !== 'undefined' ? require('./container-tree-ui') : self.SFContainerTreeUI;
  const { renderFields } = typeof require !== 'undefined' ? require('./flat-mode-ui') : self.SFFlatModeUI;
  const { renderBrowserActionsSection } = typeof require !== 'undefined' ? require('./browser-actions-ui') : self.SFBrowserActionsUI;
  const { parseAdditionalUrls } = typeof require !== 'undefined' ? require('./scraping-config-builder') : self.SFScrapingConfigBuilder;
  const { renderSettingsPanel } = typeof require !== 'undefined' ? require('./settings-panel-ui') : self.SFSettingsPanelUI;
  const { renderSavedConfigsList, fetchAllSavedConfigs } =
    typeof require !== 'undefined' ? require('./saved-configs-ui') : self.SFSavedConfigsUI;
  const { checkRobotsTxt } = typeof require !== 'undefined' ? require('./companion-client') : self.SFCompanionClient;
  const { togglePreview } = typeof require !== 'undefined' ? require('./preview') : self.SFPreview;
  const { renderCombinedSection } = typeof require !== 'undefined' ? require('./combined-config-ui') : self.SFCombinedConfigUI;

  // Duplicated verbatim from popup.js's own tiny show(id) helper — same "no
  // cross-module includes for small DOM helpers" convention already used
  // for renderMatchCountHint (see CLAUDE.md).
  function show(id) { document.getElementById(id)?.classList.remove('hidden'); }

  // Strictly separate — switching modes clears the *other* modes' configs
  // rather than keeping all three around.
  // apiConfigDraft is cleared defensively alongside apiConfig when switching
  // *away* from api mode — unreachable in practice today (the mode buttons
  // only live on screen-idle, and a non-null apiConfigDraft means
  // screen-api-config is showing instead), but keeps this table's own
  // "switching modes clears the other modes' configuration" contract honest
  // regardless of that.
  const MODE_SWITCH_CLEARS = {
    flat:      { groups: [], apiConfig: null, apiConfigDraft: null, combinedComponents: [] },
    container: { fields: [], apiConfig: null, apiConfigDraft: null, combinedComponents: [] },
    api:       { fields: [], groups: [], combinedComponents: [] },
    combined:  { fields: [], groups: [], apiConfig: null, apiConfigDraft: null },
  };

  function switchMode(bridge, mode) {
    const state = bridge.getState();
    if (mode === state.mode) return;
    log('MODE_SWITCH', mode);
    bridge.stopPreviewIfActive();
    bridge.setState(state.current, { mode, ...MODE_SWITCH_CLEARS[mode] });
    // Issue #239: fetched once on entering Combined mode rather than kept
    // continuously in sync — the picker's own "add" list is naturally a
    // little stale if a config is saved/deleted elsewhere while this popup
    // stays open, the same tradeoff fetchSavedConfigs' own hostname-scoped
    // list already accepts.
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
    document.getElementById('flat-mode-section')?.classList.toggle('hidden', state.mode !== 'flat');
    document.getElementById('container-mode-section')?.classList.toggle('hidden', state.mode !== 'container');
    document.getElementById('api-mode-section')?.classList.toggle('hidden', state.mode !== 'api');
    document.getElementById('combined-mode-section')?.classList.toggle('hidden', state.mode !== 'combined');
    // Vorschau highlights matched DOM elements — meaningless for API-Mode
    // and for Combined mode (no selectors/DOM of its own to highlight).
    document.getElementById('preview-section')?.classList.toggle('hidden', state.mode === 'api' || state.mode === 'combined');
    // Issue #239: engine/browser-actions are entirely component-level for
    // Combined mode — the companion rejects BrowserActions on the outer
    // request outright (each component's own config carries its own).
    document.getElementById('engine-section')?.classList.toggle('hidden', state.mode === 'combined');

    // Engine + browser actions (Issue #41/#42, Phase 5) — mode-independent,
    // so this sits alongside the mode toggle above rather than inside any
    // of the three mode-specific blocks.
    renderBrowserActionsSection(bridge);

    if (state.mode === 'container') {
      renderGroupTree(state.groups);
    } else if (state.mode === 'combined') {
      renderCombinedSection(bridge);
    } else {
      renderFields(state.fields);
    }

    const hasConfig = state.mode === 'container' ? state.groups.length > 0
      : state.mode === 'api' ? !!state.apiConfig
      : state.mode === 'combined' ? (state.combinedComponents || []).length >= 2
      : state.fields.length > 0;
    const genBtn = document.getElementById('btn-generate');
    if (genBtn) genBtn.disabled = !hasConfig;
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
    // Container mode always forces Xml server-side (absent Json); API mode
    // forces Xml too, but only for its tree shape (Groups) — its flat shape
    // forces Csv, same as flat mode itself. Issue #86's useJsonOutput
    // toggle overrides whichever of those would otherwise apply.
    const isTreeShapedMode = state.mode === 'container'
      || (state.mode === 'api' && !!state.apiConfig?.groups?.length);
    const outputExtEl = document.getElementById('output-filename-ext');
    if (outputExtEl) {
      outputExtEl.textContent = state.useJsonOutput ? '.json' : (isTreeShapedMode ? '.xml' : '.csv');
    }

    const outputJsonToggle = document.getElementById('toggle-output-json');
    if (outputJsonToggle) outputJsonToggle.checked = state.useJsonOutput;

    const dataPreviewToggle = document.getElementById('toggle-include-data-preview');
    if (dataPreviewToggle) dataPreviewToggle.checked = state.includeDataPreview;

    const outputFileToggle = document.getElementById('toggle-include-output-file');
    if (outputFileToggle) outputFileToggle.checked = state.includeOutputFile;

    // Issue #83: hidden for API mode — Api builds its own request URL from
    // apiConfig.urlTemplate and never reads this list at all (the companion
    // rejects the combination outright, see Program.cs).
    document.getElementById('additional-urls-row')?.classList.toggle('hidden', state.mode === 'api' || state.mode === 'combined');
    const additionalUrlsInput = document.getElementById('input-additional-urls');
    if (additionalUrlsInput && document.activeElement !== additionalUrlsInput) {
      additionalUrlsInput.value = state.additionalStartUrls.join('\n');
    }

    renderSettingsPanel(bridge);

    // Issue #141: saved-configs-section is scoped to the current page's
    // hostname (fetchSavedConfigs, kicked off from checkCompanion) —
    // rendered every pass like the other IDLE-only lists above rather than
    // only on state transitions, so an in-progress delete confirmation
    // (savedConfigsPendingDeleteId) re-renders correctly too.
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

  return {
    switchMode, renderIdleScreen, wireIdleScreenEvents,
  };
})();

if (typeof module !== 'undefined') module.exports = SFIdleScreenUI;
if (typeof self !== 'undefined') self.SFIdleScreenUI = SFIdleScreenUI;
