// The global Settings tab (screens/settings.html) — a thin orchestrator per
// CLAUDE.md's "Popup module boundaries" architecture decision: the four
// cross-session preference toggles and the default-script-name preference
// are rendered/wired directly here, while Output Blueprint management
// (output-blueprints-ui.js) and cross-site saved-config browsing
// (saved-configs-ui.js) are each rendered/wired by the existing module that
// already owns that concern — this file only calls into them, it doesn't
// duplicate their logic. Same `bridge`-parameter convention every other
// extracted feature module already uses.
const { createLogger } = require('../shared/logger');
const log = createLogger('SF:Popup');

const { getGlobalSettings, updateGlobalSettings } = require('../shared/global-settings');

const { STATES } = require('./api-config');
const { autoOpenAdvanced } = require('./advanced-disclosure-ui');

const { getAccessKey, setAccessKey } = require('../shared/companion-config');

const { t } = require('../i18n/i18n');

const { getResolvedCompanionUrl, companionFetch } = require('./companion-client');

const { renderAccountAndDeveloperSections, wireAccountAndDeveloperEvents } = require('./account-ui');

const { renderEmailAccountSection, wireEmailAccountEvents } = require('./email-account-ui');

const { renderManageBlueprintsModal } = require('./output-blueprints-ui');

const { renderAllSavedConfigsList, wireAllSavedConfigsEvents } = require('./saved-configs-ui');

function renderSettingsScreen(bridge) {
  const settings = getGlobalSettings();

  const formatSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('select-output-format'));
  if (formatSelect) formatSelect.value = settings.outputFormat;
  const previewToggle = document.getElementById('toggle-include-data-preview');
  if (previewToggle) previewToggle.checked = settings.includeDataPreview;
  const outputFileToggle = document.getElementById('toggle-include-output-file');
  if (outputFileToggle) outputFileToggle.checked = settings.includeOutputFile;
  const externalConfigToggle = document.getElementById('toggle-external-config');
  if (externalConfigToggle) externalConfigToggle.checked = settings.externalConfig;
  autoOpenAdvanced(externalConfigToggle, !!settings.externalConfig); // Issue #407
  const skipVerificationToggle = document.getElementById('toggle-skip-verification');
  if (skipVerificationToggle) skipVerificationToggle.checked = settings.skipVerification;

  const isHostnameMode = settings.scriptNameMode === 'hostname';
  document.getElementById('btn-script-name-mode-fixed')?.classList.toggle('active', !isHostnameMode);
  document.getElementById('btn-script-name-mode-hostname')?.classList.toggle('active', isHostnameMode);
  document.getElementById('script-name-fixed-row')?.classList.toggle('hidden', isHostnameMode);
  document.getElementById('script-name-hostname-hint')?.classList.toggle('hidden', !isHostnameMode);
  const fixedNameInput = document.getElementById('input-script-name-fixed');
  if (fixedNameInput && document.activeElement !== fixedNameInput) fixedNameInput.value = settings.scriptNameFixed;

  // Issue #278: the access key input (never overwritten while being typed in).
  const accessKeyInput = /** @type {HTMLInputElement | null} */ (document.getElementById('input-access-key'));
  if (accessKeyInput && document.activeElement !== accessKeyInput) accessKeyInput.value = getAccessKey();

  renderAccountAndDeveloperSections();
  renderEmailAccountSection();
  renderManageBlueprintsModal(bridge);
  renderAllSavedConfigsList(bridge);
}

// Issue #278: asks the companion who the saved key belongs to (/whoami) and
// reports it next to the input.
async function testAccessKey() {
  const status = document.getElementById('access-key-status');
  if (!status) return;
  const show = (text, warn) => {
    status.textContent = text;
    status.classList.remove('hidden');
    status.classList.toggle('warn', warn);
  };
  try {
    const response = await companionFetch(`${getResolvedCompanionUrl()}/whoami`);
    if (response.status === 401) { show(t(getAccessKey() ? 'settings.accessKeyRejected' : 'settings.accessKeyMissing'), true); return; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    show(body.authRequired ? t('settings.accessKeyOk', { name: body.name }) : t('settings.accessKeyNotNeeded'), false);
  } catch {
    show(t('settings.accessKeyUnreachable'), true);
  }
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

  document.getElementById('select-output-format')?.addEventListener('change', (e) => {
    updateAndRerender(bridge, { outputFormat: e.target.value });
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
  document.getElementById('toggle-skip-verification')?.addEventListener('change', (e) => {
    updateAndRerender(bridge, { skipVerification: e.target.checked });
  });

  document.getElementById('btn-script-name-mode-fixed')?.addEventListener('click', () => {
    updateAndRerender(bridge, { scriptNameMode: 'fixed' });
  });
  document.getElementById('btn-script-name-mode-hostname')?.addEventListener('click', () => {
    updateAndRerender(bridge, { scriptNameMode: 'hostname' });
  });
  document.getElementById('btn-access-key-save')?.addEventListener('click', async () => {
    log('BTN access-key-save');
    await setAccessKey(document.getElementById('input-access-key')?.value);
    await testAccessKey();
  });
  document.getElementById('btn-access-key-clear')?.addEventListener('click', async () => {
    log('BTN access-key-clear');
    await setAccessKey('');
    const input = /** @type {HTMLInputElement | null} */ (document.getElementById('input-access-key'));
    if (input) input.value = '';
    document.getElementById('access-key-status')?.classList.add('hidden');
  });
  document.getElementById('input-script-name-fixed')?.addEventListener('change', (e) => {
    updateAndRerender(bridge, { scriptNameFixed: e.target.value });
  });

  wireAccountAndDeveloperEvents(bridge);
  wireEmailAccountEvents(bridge);
  wireAllSavedConfigsEvents(bridge);
}

module.exports = { renderSettingsScreen, wireSettingsScreenEvents };

