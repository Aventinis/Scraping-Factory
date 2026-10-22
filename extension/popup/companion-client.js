// ── Companion HTTP client ────────────────────────────────────────────────────
// Extracted from popup.js (see CLAUDE.md's "Popup module boundaries"
// architecture decision) — every request the side panel makes to the local
// companion server (health check, robots.txt relay, /generate) lives here.
// Functions take a `bridge` object (same convention as api-config-ui.js/
// dom-tree-ui.js/preview.js) instead of closing over popup.js's own
// module-level state.
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

// Resolved fresh in checkCompanion() (default or the user's persisted
// override, see shared/companion-config.js) and reused by generate()/the
// saved-configs endpoints below — module-level rather than re-resolved per
// fetch since it only ever changes via a full CHECKING_COMPANION ->
// checkCompanion() round trip anyway.
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

// Issue #278: every request to the companion goes through here so the access
// key (when one is set — Settings screen) is sent as `Authorization: Bearer
// <key>`. Without a key the call is exactly the plain `fetch(url[, init])` it
// always was, so a companion without authentication sees no difference.
function companionFetch(url, init) {
  const key = getAccessKey();
  if (!key) return init === undefined ? fetch(url) : fetch(url, init);
  return fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${key}` } });
}

// Issue #278: /health tells whether this companion has authentication switched
// on; if so (and only then) the key is checked right away via /whoami so a
// missing or wrong key is explained up front instead of as a puzzling failure
// of the first saved-config request. Anything unexpected here (an older
// companion, a mock without a body) is silently ignored.
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
    // Issue #239: fetched unconditionally alongside the hostname-scoped list
    // above (not gated on the restored mode actually being 'combined') —
    // simpler than chasing the exact ordering between this health check and
    // session-restore's own mode restoration, and just as cheap/harmless as
    // fetchSavedConfigs itself when Combined mode never ends up being used
    // this session.
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

// Manual override entry point for the COMPANION_ERROR screen — lets the user
// point at a companion instance running on another host/port (e.g. a custom
// Companion:Port in its own appsettings.json) when the default address isn't
// reachable. Persisted via setCompanionUrlOverride so it's remembered for
// the next session (see shared/companion-config.js), then re-runs the same
// health check a plain retry would.
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

// Issue #401: shows a failed Generate. A failure the mapping recognises (the
// common classes — no data, site unreachable/refused, missing variable, an
// invalid configuration, ...) gets a plain-language title and hint with the
// original text behind "Details"; anything else keeps today's wording. `reportable`
// = whether "Report bug" is offered (false for a configuration the user can fix).
// The raw text is always what lands in a bug report.
function showGenerateFailure(rawMessage, { engine, reportable, fallbackKey }) {
  const plain = describeError(rawMessage, { engine });
  const context = reportable ? 'Script generation' : null;
  if (plain) {
    showErrorToast({ title: plain.title, hint: plain.hint, details: rawMessage }, context);
    return;
  }
  showToast(t(fallbackKey, { message: rawMessage }), context);
}

// Issue #239: a component in _state.combinedComponents only ever stores
// {savedConfigId, name} — its full underlying ScrapingConfig is resolved
// live here (GET /configs/{id}) at generate/save/export time, never cached
// from whenever it was picked, so editing/re-saving the source config
// elsewhere is picked up automatically. Throws (naming the offending
// component) if a referenced saved configuration no longer exists — callers
// surface that the same way any other generation failure already is.
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
  // Issue #43: one-time login/test values, sent only in this request body —
  // deliberately kept out of `config` (and therefore out of the log line
  // below, buildConfigExport, and the "Report bug" log export) since none of
  // those are meant to ever see them. See fillTestValues/buildVerificationValues.
  // Issue #220: Api mode's bootstrap credentials get the same one-time
  // test-value treatment, from the API_CONFIG screen's own inputs.
  // Issue #226: the DOM modes' env-var-backed request headers get the same
  // one-time test-value treatment.
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
      showGenerateFailure(data?.error || t('toast.verificationFailed'), { engine: state.engine, reportable: false, fallbackKey: 'toast.configInvalid' });
      return;
    }
    if (res.status === 422) {
      const data = await res.json().catch(() => null);
      log('GENERATE VERIFICATION FAIL', data);
      throw new Error(buildVerificationErrorMessage(data));
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Issue #289 follow-up: present regardless of whether the body below
    // ends up plain-text or the JSON preview/outputFile envelope — a header
    // survives either response shape unchanged, unlike a body field that
    // would need its own per-shape plumbing. Shown as a warning toast (the
    // same "raw companion-originated English text, not routed through
    // i18n" convention buildVerificationErrorMessage's own 422 handling
    // already uses) rather than failing the request — the script itself was
    // still generated successfully, just not run against the live page.
    const verificationSkippedReason = res.headers?.get('X-ScrapingFactory-Verification-Skipped');

    // Issue #122/#161: only when includeDataPreview or includeOutputFile
    // asked for it does the companion respond with a JSON envelope
    // ({ script, preview, outputFile }) instead of the plain script text —
    // the client already knows which one(s) it requested, no need to sniff
    // the response's Content-Type.
    let scriptText;
    let dataPreview = null;
    let outputFile = null;
    let blocksOutput = null;
    if (globalSettings.includeDataPreview || globalSettings.includeOutputFile) {
      const data = await res.json();
      scriptText = data.script;
      // Issue #182: Blocks mode's own envelope is { script, blocks: [...] }
      // instead of { script, preview, outputFile } — self-describes via the
      // presence of `blocks` rather than branching on state.mode, so this
      // stays correct even if a Blocks response somehow arrives outside the
      // Blocks-mode code path.
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

// Called from popup.js's render() only while _state.current ===
// STATES.COMPANION_ERROR — fills in the currently-resolved companion URL
// (default or override) and, if the user hasn't typed anything yet, seeds
// the override input with the current override (blank when it's still just
// the default, so the placeholder shows through instead of a redundant
// pre-filled default value).
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

