// ── Companion HTTP client ────────────────────────────────────────────────────
// Extracted from popup.js (see CLAUDE.md's "Popup module boundaries"
// architecture decision) — every request the side panel makes to the local
// companion server (health check, robots.txt relay, /generate) lives here.
// Functions take a `bridge` object (same convention as api-config-ui.js/
// dom-tree-ui.js/preview.js) instead of closing over popup.js's own
// module-level state.
const SFCompanionClient = (function() {
const { createLogger } =
  typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
const log = createLogger('SF:Popup');

const { t } =
  typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;

const { getCompanionUrl, setCompanionUrlOverride, resetCompanionUrlOverride, normalizeUrl } =
  typeof require !== 'undefined' ? require('../shared/companion-config') : self.SFCompanionConfig;

const { STATES } =
  typeof require !== 'undefined' ? require('./api-config') : self.SFApiConfig;

const { showToast, setLastError } =
  typeof require !== 'undefined' ? require('./toast') : self.SFToast;

const { buildScrapingConfig, buildVerificationValues } =
  typeof require !== 'undefined' ? require('./scraping-config-builder') : self.SFScrapingConfigBuilder;

// Resolved fresh in checkCompanion() (default or the user's persisted
// override, see shared/companion-config.js) and reused by generate()/the
// saved-configs endpoints below — module-level rather than re-resolved per
// fetch since it only ever changes via a full CHECKING_COMPANION ->
// checkCompanion() round trip anyway.
let companionUrl = null;

function getResolvedCompanionUrl() {
  return companionUrl;
}

async function checkCompanion(bridge) {
  companionUrl = await getCompanionUrl();
  log('HEALTH_CHECK start', companionUrl);
  try {
    const res = await fetch(`${companionUrl}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log('HEALTH_CHECK OK');

    const tabs = await new Promise(resolve =>
      chrome.tabs.query({ active: true, currentWindow: true }, resolve)
    );
    const url = tabs[0]?.url ?? '';
    log('TAB_URL', url);
    bridge.setState(STATES.IDLE, { url });
    // Issue #141: fire-and-forget — fetchSavedConfigs patches state itself
    // once (or if) it resolves, no need to await/block the IDLE transition
    // on it.
    if (url) bridge.fetchSavedConfigs(url);
  } catch (err) {
    log('HEALTH_CHECK FAIL', err.message);
    setLastError(err.message, 'Companion connection');
    bridge.setState(STATES.COMPANION_ERROR);
  }
}

// Manual override entry point for the COMPANION_ERROR screen — lets the user
// point at a companion instance running on another host/port (e.g. a custom
// Companion:Port in its own appsettings.json) when the default address isn't
// reachable. Persisted via setCompanionUrlOverride so it's remembered for
// the next session (see shared/companion-config.js), then re-runs the same
// health check a plain retry would.
async function useCustomCompanionUrl(bridge, rawUrl) {
  const normalized = normalizeUrl(rawUrl);
  let parsed = null;
  try {
    parsed = new URL(normalized);
  } catch {
    // parsed stays null — reported as invalid below, same as an empty input.
  }
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
    showToast(t('toast.invalidCompanionUrl'));
    return;
  }
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

// robots.txt is fetched by the content script (same-origin relative to the
// inspected page, see checkRobotsTxt in content-script.js) — the side panel
// only relays the request/response through the service worker, same
// request/response shape as GET_LOGS.
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

// The companion actually generates and runs the script against the live
// page before handing it out (same rendering stage, and now the exact
// artifact the user would download) and responds 422 with a message when
// that run fails or errors — is the page unreachable, does the script raise
// an exception, or does it run cleanly but write no data (all selectors
// found nothing). `data` is logged separately so it ends up in the bug
// report if the user reports it.
function buildVerificationErrorMessage(data) {
  return data?.error || t('toast.verificationFailed');
}

async function generate(bridge) {
  bridge.stopPreviewIfActive();
  bridge.setState(STATES.GENERATING);
  const state = bridge.getState();
  const config = buildScrapingConfig(
    state.url, state.mode, state.fields, state.groups, state.apiConfig,
    state.scriptFileName, state.outputFileName, state.engine, state.browserActions, state.includeDataPreview,
    state.useJsonOutput, state.additionalStartUrls, state.changeDetection, state.proxy, state.hardening,
    state.pagination, state.persistentSession, state.includeOutputFile, state.externalConfig,
  );
  // Issue #43: one-time login/test values, sent only in this request body —
  // deliberately kept out of `config` (and therefore out of the log line
  // below, buildConfigExport, and the "Report bug" log export) since none of
  // those are meant to ever see them. See fillTestValues/buildVerificationValues.
  const verificationValues = state.engine === 'Browser'
    ? buildVerificationValues(state.browserActions, state.fillTestValues)
    : {};
  log('GENERATE request', config);
  try {
    const res = await fetch(`${companionUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        Object.keys(verificationValues).length > 0 ? { ...config, verificationValues } : config,
      ),
    });
    if (res.status === 400) {
      // A structural config rejection (bad URL, mutually exclusive Fields/
      // Groups/Api, a FramePath without Engine=Browser, ...) — always a
      // deterministic, pre-execution validation failure caused by the
      // current configuration, never a companion/script malfunction. Unlike
      // the 422/network-error cases below, no "Report bug" prompt is
      // offered — showToast's context arg is intentionally omitted, since
      // inviting a bug report here would just fill GitHub issues with
      // non-bugs (an invalid config, not a defect).
      const data = await res.json().catch(() => null);
      log('GENERATE CONFIG INVALID', data);
      bridge.setState(STATES.IDLE);
      showToast(t('toast.configInvalid', { message: data?.error || t('toast.verificationFailed') }));
      return;
    }
    if (res.status === 422) {
      const data = await res.json().catch(() => null);
      log('GENERATE VERIFICATION FAIL', data);
      throw new Error(buildVerificationErrorMessage(data));
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Issue #122/#161: only when includeDataPreview or includeOutputFile
    // asked for it does the companion respond with a JSON envelope
    // ({ script, preview, outputFile }) instead of the plain script text —
    // the client already knows which one(s) it requested, no need to sniff
    // the response's Content-Type.
    let scriptText;
    let dataPreview = null;
    let outputFile = null;
    if (state.includeDataPreview || state.includeOutputFile) {
      const data = await res.json();
      scriptText = data.script;
      dataPreview = data.preview ?? null;
      outputFile = data.outputFile ?? null;
    } else {
      scriptText = await res.text();
    }
    log('GENERATE OK', `${scriptText.length} chars` +
      (dataPreview ? `, preview: ${dataPreview.totalCount} rows/elements` : '') +
      (outputFile ? `, outputFile: ${outputFile.fileName} (${outputFile.content.length} chars)` : ''));
    bridge.setState(STATES.DONE, { scriptText, dataPreview, outputFile });
  } catch (err) {
    log('GENERATE FAIL', err.message);
    bridge.setState(STATES.IDLE);
    showToast(t('toast.generationError', { message: err.message }), 'Script generation');
  }
}

  return {getResolvedCompanionUrl, checkCompanion, useCustomCompanionUrl, resetCustomCompanionUrl,
    checkRobotsTxt, buildVerificationErrorMessage, generate,};
})();

if (typeof module !== 'undefined') module.exports = SFCompanionClient;
if (typeof self !== 'undefined') self.SFCompanionClient = SFCompanionClient;
