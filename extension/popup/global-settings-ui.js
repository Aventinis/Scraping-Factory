// The global Settings tab (screens/settings.html) — a thin orchestrator per
// CLAUDE.md's "Popup module boundaries" architecture decision: the four
// cross-session preference toggles and the default-script-name preference
// are rendered/wired directly here, while Output Blueprint management
// (output-blueprints-ui.js) and cross-site saved-config browsing
// (saved-configs-ui.js) are each rendered/wired by the existing module that
// already owns that concern — this file only calls into them, it doesn't
// duplicate their logic. Same `bridge`-parameter convention every other
// extracted feature module already uses.
const SFGlobalSettingsUI = (function () {
  const { createLogger } = typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
  const log = createLogger('SF:Popup');

  const { getGlobalSettings, updateGlobalSettings } =
    typeof require !== 'undefined' ? require('../shared/global-settings') : self.SFGlobalSettings;

  const { STATES } = typeof require !== 'undefined' ? require('./api-config') : self.SFApiConfig;

  const { renderManageBlueprintsModal } =
    typeof require !== 'undefined' ? require('./output-blueprints-ui') : self.SFOutputBlueprintsUI;

  const { renderAllSavedConfigsList, wireAllSavedConfigsEvents } =
    typeof require !== 'undefined' ? require('./saved-configs-ui') : self.SFSavedConfigsUI;

  function renderSettingsScreen(bridge) {
    const settings = getGlobalSettings();

    const jsonToggle = document.getElementById('toggle-output-json');
    if (jsonToggle) jsonToggle.checked = settings.outputAsJson;
    const previewToggle = document.getElementById('toggle-include-data-preview');
    if (previewToggle) previewToggle.checked = settings.includeDataPreview;
    const outputFileToggle = document.getElementById('toggle-include-output-file');
    if (outputFileToggle) outputFileToggle.checked = settings.includeOutputFile;
    const externalConfigToggle = document.getElementById('toggle-external-config');
    if (externalConfigToggle) externalConfigToggle.checked = settings.externalConfig;

    const isHostnameMode = settings.scriptNameMode === 'hostname';
    document.getElementById('btn-script-name-mode-fixed')?.classList.toggle('active', !isHostnameMode);
    document.getElementById('btn-script-name-mode-hostname')?.classList.toggle('active', isHostnameMode);
    document.getElementById('script-name-fixed-row')?.classList.toggle('hidden', isHostnameMode);
    document.getElementById('script-name-hostname-hint')?.classList.toggle('hidden', !isHostnameMode);
    const fixedNameInput = document.getElementById('input-script-name-fixed');
    if (fixedNameInput && document.activeElement !== fixedNameInput) fixedNameInput.value = settings.scriptNameFixed;

    renderManageBlueprintsModal(bridge);
    renderAllSavedConfigsList(bridge);
  }

  // updateGlobalSettings's own cache update happens synchronously (before
  // its first `await`, see shared/global-settings.js's own doc comment) —
  // so a plain, un-awaited call already left the cache in its new state by
  // the time the immediately-following bridge.patchState({}) re-renders
  // from it. Fire-and-forget, same "best-effort persist" treatment
  // shared/theme.js/companion-config.js's own writes already get.
  function updateAndRerender(bridge, patch) {
    updateGlobalSettings(patch);
    bridge.patchState({});
  }

  function wireSettingsScreenEvents(bridge) {
    document.getElementById('btn-open-settings')?.addEventListener('click', () => {
      log('BTN open-settings');
      // Same "reset the delete-confirm state on open" behavior
      // openManageBlueprintsModal/requestDeleteSavedConfig's own callers
      // used to get for free from the modal being freshly (re)opened each
      // time — now a permanent section, so it's reset explicitly here.
      bridge.setState(STATES.SETTINGS, { blueprintDeletePendingId: null, allSavedConfigsPendingDeleteId: null });
    });
    document.getElementById('btn-close-settings')?.addEventListener('click', () => {
      log('BTN close-settings');
      bridge.setState(STATES.IDLE);
    });

    document.getElementById('toggle-output-json')?.addEventListener('change', (e) => {
      updateAndRerender(bridge, { outputAsJson: e.target.checked });
    });
    document.getElementById('toggle-include-data-preview')?.addEventListener('change', (e) => {
      updateAndRerender(bridge, { includeDataPreview: e.target.checked });
    });
    document.getElementById('toggle-include-output-file')?.addEventListener('change', (e) => {
      updateAndRerender(bridge, { includeOutputFile: e.target.checked });
    });
    document.getElementById('toggle-external-config')?.addEventListener('change', (e) => {
      updateAndRerender(bridge, { externalConfig: e.target.checked });
    });

    document.getElementById('btn-script-name-mode-fixed')?.addEventListener('click', () => {
      updateAndRerender(bridge, { scriptNameMode: 'fixed' });
    });
    document.getElementById('btn-script-name-mode-hostname')?.addEventListener('click', () => {
      updateAndRerender(bridge, { scriptNameMode: 'hostname' });
    });
    document.getElementById('input-script-name-fixed')?.addEventListener('change', (e) => {
      updateAndRerender(bridge, { scriptNameFixed: e.target.value });
    });

    wireAllSavedConfigsEvents(bridge);
  }

  return { renderSettingsScreen, wireSettingsScreenEvents };
})();

if (typeof module !== 'undefined') module.exports = SFGlobalSettingsUI;
if (typeof self !== 'undefined') self.SFGlobalSettingsUI = SFGlobalSettingsUI;
