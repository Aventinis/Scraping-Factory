// ── Companion HTTP client ──
// Every request the side panel makes to the companion (health check, robots.txt relay, /generate). Functions take a
// `bridge` (see api-config-ui.js) instead of closing over popup.js state.
const { createLogger } = require('../shared/logger');
const log = createLogger('SF:Popup');

const { t } = require('../i18n/i18n');

const { getCompanionUrl, setCompanionUrlOverride, resetCompanionUrlOverride, normalizeUrl, DEFAULT_COMPANION_URL, loadAccessKey, getAccessKey, checkCompanionUrl, loadDeveloperOptions } =
  require('../shared/companion-config');

const { STATES } = require('./api-config');

const { showToast, showErrorToast, hideToast, setLastError } = require('./toast');

const { buildScrapingConfig, buildVerificationValues, computeScriptFileNamePatch } =
  require('./scraping-config-builder');

const { buildHeaderVerificationValues } = require('./request-headers');
const { buildBootstrapVerificationValues } = require('./api-bootstrap');

const { getGlobalSettings } = require('../shared/global-settings');

const { loadCompanionReached, markCompanionReached } = require('./companion-guidance');
const { describeError } = require('./error-messages');
const { findInvalidEnvVarNames } = require('./env-var');

// Resolved in checkCompanion() (default or the persisted override, shared/companion-config.js) and reused by generate() and
// the saved-configs endpoints; it only changes through a full health-check round trip.
let companionUrl = null;

function getResolvedCompanionUrl() {
  return companionUrl;
}

// What /health last said about this companion (Issue #352): whether it wants
// an access key at all and whether it offers self-registration — the Settings
// screen's Account section follows it. Both false until a health check answers.
let companionInfo = { authRequired: false, registration: false, email: 'off', passwordReset: false, verifiedEmailRequired: false };

function getCompanionInfo() {
  return companionInfo;
}

// The last failed health check ({ message }, or null after a successful one) —
// the COMPANION_ERROR screen's guidance (Issue #406) reads it to tell which of
// the usual causes is the most likely.
let companionFailure = null;

function getCompanionFailure() {
  return companionFailure;
}

// Every request to the companion goes through here so the access key (if set) is sent as `Authorization: Bearer <key>`;
// without a key it is the plain fetch.
function companionFetch(url, init) {
  const key = getAccessKey();
  if (!key) return init === undefined ? fetch(url) : fetch(url, init);
  return fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${key}` } });
}

// /health says whether authentication is on; only then is the key checked via /whoami, so a missing or wrong key is explained up
// front. Anything unexpected (an older companion) is ignored.
async function warnAboutAccessKey(healthResponse) {
  try {
    const body = await healthResponse.json();
    companionInfo = {
      authRequired: body?.authRequired === true,
      registration: body?.registration === true,
      // Issue #353: whether an email address is asked for ('off' | 'optional' | 'required'),
      // whether a forgotten password can be reset by mail, and the operator's verified-email rule.
      email: ['optional', 'required'].includes(body?.email) ? body.email : 'off',
      passwordReset: body?.passwordReset === true,
      verifiedEmailRequired: body?.verifiedEmailRequired === true,
    };
    if (body?.authRequired !== true) return;
    const whoami = await companionFetch(`${companionUrl}/whoami`);
    if (whoami.status === 401) {
      showToast(t(getAccessKey() ? 'toast.accessKeyRejected' : 'toast.accessKeyRequired'), null, 'warn');
    } else if (whoami.ok && companionInfo.verifiedEmailRequired) {
      // Issue #353: signed in, but the companion won't serve data before the address is confirmed.
      const who = await whoami.json();
      if (who?.emailVerified !== true) showToast(t('toast.emailUnverified'), null, 'warn');
    }
  } catch {
    // not an authentication-aware companion
  }
}

async function checkCompanion(bridge) {
  // Developer options first: whether a stored http:// address is still allowed depends on them.
  await loadDeveloperOptions();
  companionUrl = await getCompanionUrl();
  await loadAccessKey();
  await loadCompanionReached(); // Issue #406: first-run vs. returning-user guidance
  log('HEALTH_CHECK start', companionUrl);
  try {
    const res = await fetch(`${companionUrl}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log('HEALTH_CHECK OK');
    companionFailure = null;
    await markCompanionReached();
    await warnAboutAccessKey(res);

    const tabs = await new Promise(resolve =>
      chrome.tabs.query({ active: true, currentWindow: true }, resolve)
    );
    const url = tabs[0]?.url ?? '';
    log('TAB_URL', url);
    // Issue-driven follow-up: the default-script-name preference — see
    // computeScriptFileNamePatch's own doc comment for the 'hostname'-vs-
    // 'fixed' mode rule.
    const scriptFileNamePatch = computeScriptFileNamePatch(bridge.getState().scriptFileName, url, getGlobalSettings());
    bridge.setState(STATES.IDLE, { url, ...scriptFileNamePatch });
    // Issue #141: fire-and-forget — fetchSavedConfigs patches state itself
    // once (or if) it resolves, no need to await/block the IDLE transition
    // on it.
    if (url) bridge.fetchSavedConfigs(url);
    // Fetched unconditionally (not gated on the restored mode): simpler than ordering this against session restore, and cheap.
    bridge.fetchAllSavedConfigs();
    // Issue #191: fetched unconditionally like fetchAllSavedConfigs above —
    // a blueprint is reusable across any site/mode, so there's no "current
    // mode" gate to wait for either.
    bridge.fetchOutputBlueprints();
    // Issue #279: same "reusable across any site" reasoning as blueprints.
    bridge.fetchTransformPresets?.();
  } catch (err) {
    log('HEALTH_CHECK FAIL', err.message);
    companionFailure = { message: err.message };
    setLastError(err.message, 'Companion connection');
    bridge.setState(STATES.COMPANION_ERROR);
  }
}

// Entry point of the COMPANION_ERROR screen's address field: persists the override (shared/companion-config.js), then re-runs
// the health check.
async function useCustomCompanionUrl(bridge, rawUrl) {
  // Issue #352: https always, plain http only for this computer (and, in a
  // development build with the developer option on, anywhere) — see
  // shared/companion-config.js's checkCompanionUrl.
  const checked = checkCompanionUrl(rawUrl);
  if (!checked.ok) {
    showToast(t(checked.reason === 'insecure' ? 'toast.insecureCompanionUrl' : 'toast.invalidCompanionUrl'));
    return;
  }
  const normalized = checked.url;
  log('COMPANION_URL_OVERRIDE set', normalized);
  await setCompanionUrlOverride(normalized);
  bridge.setState(STATES.CHECKING_COMPANION);
  await checkCompanion(bridge);
}

async function resetCustomCompanionUrl(bridge) {
  log('COMPANION_URL_OVERRIDE reset');
  await resetCompanionUrlOverride();
  bridge.setState(STATES.CHECKING_COMPANION);
  await checkCompanion(bridge);
}

// robots.txt is fetched by the content script (same origin as the page); the panel only relays the request through the
// service worker, like GET_LOGS.
async function checkRobotsTxt(bridge) {
  log('ROBOTS_TXT_CHECK start');
  bridge.patchState({ robotsTxtChecking: true, robotsTxtResult: null });
  try {
    const result = await chrome.runtime.sendMessage({ type: 'CHECK_ROBOTS_TXT' });
    log('ROBOTS_TXT_CHECK result', result);
    bridge.patchState({ robotsTxtChecking: false, robotsTxtResult: result });
  } catch (err) {
    log('ROBOTS_TXT_CHECK failed', err.message);
    bridge.patchState({ robotsTxtChecking: false, robotsTxtResult: { ok: false, error: err.message } });
  }
}

// The companion generates and runs the script against the live page and answers 422 when that fails (page unreachable, an
// exception, or no data). `data` is logged separately so it reaches a bug report.
function buildVerificationErrorMessage(data) {
  return data?.error || t('toast.verificationFailed');
}

// Shows a failed Generate: a recognised failure gets a plain-language title and hint with the original text behind
// "Details", anything else keeps the raw wording. `reportable` = whether "Report bug" is offered (false for a
// configuration the user can fix). The raw text always goes into a bug report.
function showGenerateFailure(rawMessage, { engine, reportable, fallbackKey }) {
  const plain = describeError(rawMessage, { engine });
  const context = reportable ? 'Script generation' : null;
  if (plain) {
    showErrorToast({ title: plain.title, hint: plain.hint, details: rawMessage }, context);
    return;
  }
  showToast(t(fallbackKey, { message: rawMessage }), context);
}

// A component only stores {savedConfigId, name}; its ScrapingConfig is resolved live (GET /configs/{id}) at generate / save /
// export time so edits to the source config are picked up. Throws, naming the component, if it no longer exists.
async function resolveCombinedComponents(components) {
  const resolved = [];
  for (const component of components) {
    const res = await companionFetch(`${getResolvedCompanionUrl()}/configs/${component.savedConfigId}`);
    if (!res.ok) throw new Error(t('toast.combinedComponentUnresolvable', { name: component.name }));
    const record = await res.json();
    resolved.push({ name: component.name, config: record.config, savedConfigId: component.savedConfigId });
  }
  return resolved;
}

async function generate(bridge) {
  hideToast(); // a failure from the previous attempt (Issue #401: those stay until closed)
  bridge.stopPreviewIfActive();
  bridge.setState(STATES.GENERATING);
  const state = bridge.getState();

  let combinedComponents = null;
  if (state.mode === 'combined') {
    try {
      combinedComponents = await resolveCombinedComponents(state.combinedComponents || []);
    } catch (err) {
      log('GENERATE COMBINED RESOLVE FAIL', err.message);
      bridge.setState(STATES.IDLE);
      showToast(t('toast.generationError', { message: err.message }), 'Script generation');
      return;
    }
  }

  // Issue-driven follow-up: outputAsJson/includeDataPreview/includeOutputFile/
  // externalConfig moved from per-scrape _state to the cross-session global
  // Settings tab (shared/global-settings.js) — read from there now.
  const globalSettings = getGlobalSettings();
  const config = buildScrapingConfig(
    state.url, state.mode, state.fields, state.groups, state.apiConfig,
    state.scriptFileName, state.outputFileName, state.engine, state.browserActions, globalSettings.includeDataPreview,
    globalSettings.outputFormat, state.additionalStartUrls, state.changeDetection, state.proxy, state.hardening,
    state.pagination, state.persistentSession, globalSettings.includeOutputFile, globalSettings.externalConfig, combinedComponents,
    state.blocks, state.selectedOutputBlueprintId, state.selectedOutputBlueprintFieldNames, state.outputBlueprintMapping,
    state.selectedOutputBlueprintSchemaKind, state.selectedOutputBlueprintTree, state.outputBlueprintTreeMapping,
    state.discoveredUrls, state.preflight, state.requestDelay, state.retry, state.deduplication, state.requestHeaders, state.respectRobotsDelay, globalSettings.skipVerification, state.robotsDisallow, state.appendOutput,
  );
  // One-time test values (Fill, bootstrap, request headers) go only in this request body, deliberately out of `config` and so
  // out of the log line, the export and bug reports. A bad environment-variable name is reported up front, naming it.
  const invalidEnvVars = findInvalidEnvVarNames(config);
  if (invalidEnvVars.length > 0) {
    const { name, reason } = invalidEnvVars[0];
    log('GENERATE BLOCKED invalid env var name', invalidEnvVars);
    bridge.setState(STATES.IDLE);
    showToast(t('envVar.generateBlocked', { message: t(`envVar.${reason}`, { name }) }), null, 'warn');
    return;
  }
  const verificationValues = state.mode === 'api'
    ? buildBootstrapVerificationValues(state.apiConfig, state.apiBootstrapTestValues || {})
    : {
        ...(state.engine === 'Browser' ? buildVerificationValues(state.browserActions, state.fillTestValues) : {}),
        ...buildHeaderVerificationValues(state.requestHeaders, state.requestHeaderTestValues),
      };
  log('GENERATE request', config);
  try {
    const res = await companionFetch(`${companionUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        Object.keys(verificationValues).length > 0 ? { ...config, verificationValues } : config,
      ),
    });
    if (res.status === 400) {
      // A structural rejection (bad URL, exclusive modes, FramePath without Browser, ...) is a deterministic validation failure of
      // the current configuration, not a defect, so no "Report bug" is offered.
      const data = await res.json().catch(() => null);
      log('GENERATE CONFIG INVALID', data);
      bridge.setState(STATES.IDLE);
      showGenerateFailure(data?.error || t('toast.verificationFailed'), { engine: state.engine, reportable: false, fallbackKey: 'toast.configInvalid' });
      return;
    }
    if (res.status === 422) {
      const data = await res.json().catch(() => null);
      log('GENERATE VERIFICATION FAIL', data);
      throw new Error(buildVerificationErrorMessage(data));
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // The verification-skipped header exists for either body shape; shown as a warning (the companion's English text as is, not
    // i18n) since the script itself was generated.
    const verificationSkippedReason = res.headers?.get('X-ScrapingFactory-Verification-Skipped');

    // Only when a preview or output file was requested is the response a JSON envelope ({ script, preview, outputFile }); the
    // client knows which it asked for, so no Content-Type sniffing.
    let scriptText;
    let dataPreview = null;
    let outputFile = null;
    let blocksOutput = null;
    if (globalSettings.includeDataPreview || globalSettings.includeOutputFile) {
      const data = await res.json();
      scriptText = data.script;
      // Blocks mode answers { script, blocks: [...] }; recognised by the presence of `blocks`, not by state.mode.
      if (Array.isArray(data.blocks)) {
        blocksOutput = data.blocks;
      } else {
        dataPreview = data.preview ?? null;
        outputFile = data.outputFile ?? null;
      }
    } else {
      scriptText = await res.text();
    }
    log('GENERATE OK', `${scriptText.length} chars` +
      (dataPreview ? `, preview: ${dataPreview.totalCount} rows/elements` : '') +
      (outputFile ? `, outputFile: ${outputFile.fileName} (${outputFile.content.length} chars)` : '') +
      (blocksOutput ? `, blocks: ${blocksOutput.length}` : ''));
    if (verificationSkippedReason) {
      // Expected, safety-cap behavior, not a malfunction — no "Report bug"
      // context (null), same treatment the 400/config-invalid toast above
      // already gives a deterministic, non-bug outcome.
      showToast(verificationSkippedReason, null, 'warn');
    }
    bridge.setState(STATES.DONE, { scriptText, dataPreview, outputFile, blocksOutput });
  } catch (err) {
    log('GENERATE FAIL', err.message);
    bridge.setState(STATES.IDLE);
    showGenerateFailure(err.message, { engine: state.engine, reportable: true, fallbackKey: 'toast.generationError' });
  }
}

// Called from render() only on COMPANION_ERROR: fills in the resolved companion URL and seeds the override input (blank when it
// is still the default, so the placeholder shows).
function renderCompanionErrorScreen() {
  const currentUrlEl = document.getElementById('error-current-url');
  if (currentUrlEl) currentUrlEl.textContent = t('error.currentUrl', { url: getResolvedCompanionUrl() || DEFAULT_COMPANION_URL });
  const urlInput = document.getElementById('input-companion-url');
  if (urlInput && !urlInput.value) urlInput.value = getResolvedCompanionUrl() && getResolvedCompanionUrl() !== DEFAULT_COMPANION_URL ? getResolvedCompanionUrl() : '';
}

function wireCompanionErrorEvents(bridge) {
  document.getElementById('btn-retry')?.addEventListener('click', () => {
    log('BTN retry');
    bridge.setState(STATES.CHECKING_COMPANION);
    checkCompanion(bridge);
  });

  document.getElementById('btn-use-companion-url')?.addEventListener('click', () => {
    log('BTN use-companion-url');
    const input = document.getElementById('input-companion-url');
    useCustomCompanionUrl(bridge, input?.value || '');
  });

  document.getElementById('btn-reset-companion-url')?.addEventListener('click', () => {
    log('BTN reset-companion-url');
    resetCustomCompanionUrl(bridge);
  });
}

module.exports = {getResolvedCompanionUrl, getCompanionInfo, getCompanionFailure, companionFetch, checkCompanion, useCustomCompanionUrl, resetCustomCompanionUrl,
  checkRobotsTxt, buildVerificationErrorMessage, generate, resolveCombinedComponents,
  renderCompanionErrorScreen, wireCompanionErrorEvents,};

