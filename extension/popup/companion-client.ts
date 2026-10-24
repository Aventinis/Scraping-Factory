// ── Companion HTTP client ──
// Every request the side panel makes to the companion (health check, robots.txt relay, /generate). Functions take a
// `bridge` (see api-config-ui.ts) instead of closing over popup.ts state.
import type * as SFWire from '../types/wire';
import type * as SFDraft from '../types/drafts';
import type { PopupBridge, BlockOutput, DataPreview, OutputFileContent } from '../types/popup';
import type { RobotsTxtResult } from '../types/messages';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import {
  getCompanionUrl, setCompanionUrlOverride, resetCompanionUrlOverride, DEFAULT_COMPANION_URL, loadAccessKey, getAccessKey, checkCompanionUrl,
  loadDeveloperOptions,
} from '../shared/companion-config';
import { STATES } from './api-config';
import { showToast, showErrorToast, hideToast, setLastError } from './toast';
import { buildScrapingConfig, buildVerificationValues, computeScriptFileNamePatch, configOptionsFromState } from './scraping-config-builder';
import type { CombinedComponentRef } from './combined-config';
import { buildHeaderVerificationValues } from './request-headers';
import { buildBootstrapVerificationValues } from './api-bootstrap';
import { getGlobalSettings } from '../shared/global-settings';
import { loadCompanionReached, markCompanionReached } from './companion-guidance';
import { describeError } from './error-messages';
import { findInvalidEnvVarNames } from './env-var';

const log = createLogger('SF:Popup');

export interface CompanionInfo {
  authRequired: boolean;
  registration: boolean;
  email: 'off' | 'optional' | 'required';
  passwordReset: boolean;
  verifiedEmailRequired: boolean;
}

export interface CompanionFailure {
  message: string;
}

// What /generate answers when a preview or the output file was requested ({ script, preview, outputFile }), or, in Blocks mode,
// { script, blocks }. The companion's own response, so asserted where it is read.
interface GenerateEnvelope {
  script: string;
  preview?: DataPreview | null;
  outputFile?: OutputFileContent | null;
  blocks?: BlockOutput[];
}

// Resolved in checkCompanion() (default or the persisted override, shared/companion-config.ts) and reused by generate() and
// the saved-configs endpoints; it only changes through a full health-check round trip.
let companionUrl: string | null = null;

export function getResolvedCompanionUrl(): string | null {
  return companionUrl;
}

// What /health last said about this companion (Issue #352): whether it wants
// an access key at all and whether it offers self-registration — the Settings
// screen's Account section follows it. Both false until a health check answers.
let companionInfo: CompanionInfo = { authRequired: false, registration: false, email: 'off', passwordReset: false, verifiedEmailRequired: false };

export function getCompanionInfo(): CompanionInfo {
  return companionInfo;
}

// The last failed health check ({ message }, or null after a successful one) —
// the COMPANION_ERROR screen's guidance (Issue #406) reads it to tell which of
// the usual causes is the most likely.
let companionFailure: CompanionFailure | null = null;

export function getCompanionFailure(): CompanionFailure | null {
  return companionFailure;
}

// Every request to the companion goes through here so the access key (if set) is sent as `Authorization: Bearer <key>`;
// without a key it is the plain fetch.
export function companionFetch(url: string, init?: RequestInit): Promise<Response> {
  const key = getAccessKey();
  if (!key) return init === undefined ? fetch(url) : fetch(url, init);
  return fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${key}` } });
}

// /health says whether authentication is on; only then is the key checked via /whoami, so a missing or wrong key is explained up
// front. Anything unexpected (an older companion) is ignored.
async function warnAboutAccessKey(healthResponse: Response): Promise<void> {
  try {
    // /health's body, from a companion of any age: every field is checked before it is used.
    const body: { authRequired?: unknown; registration?: unknown; email?: unknown; passwordReset?: unknown; verifiedEmailRequired?: unknown } | null =
      await healthResponse.json();
    companionInfo = {
      authRequired: body?.authRequired === true,
      registration: body?.registration === true,
      // Issue #353: whether an email address is asked for ('off' | 'optional' | 'required'),
      // whether a forgotten password can be reset by mail, and the operator's verified-email rule.
      email: body?.email === 'optional' || body?.email === 'required' ? body.email : 'off',
      passwordReset: body?.passwordReset === true,
      verifiedEmailRequired: body?.verifiedEmailRequired === true,
    };
    if (body?.authRequired !== true) return;
    const whoami = await companionFetch(`${companionUrl}/whoami`);
    if (whoami.status === 401) {
      showToast(t(getAccessKey() ? 'toast.accessKeyRejected' : 'toast.accessKeyRequired'), null, 'warn');
    } else if (whoami.ok && companionInfo.verifiedEmailRequired) {
      // Issue #353: signed in, but the companion won't serve data before the address is confirmed.
      const who: { emailVerified?: unknown } | null = await whoami.json();
      if (who?.emailVerified !== true) showToast(t('toast.emailUnverified'), null, 'warn');
    }
  } catch {
    // not an authentication-aware companion
  }
}

export async function checkCompanion(bridge: PopupBridge): Promise<void> {
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

    const tabs = await new Promise<chrome.tabs.Tab[]>(resolve =>
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
    log('HEALTH_CHECK FAIL', (err as Error).message);
    companionFailure = { message: (err as Error).message };
    setLastError((err as Error).message, 'Companion connection');
    bridge.setState(STATES.COMPANION_ERROR);
  }
}

// Entry point of the COMPANION_ERROR screen's address field: persists the override (shared/companion-config.ts), then re-runs
// the health check.
export async function useCustomCompanionUrl(bridge: PopupBridge, rawUrl: string): Promise<void> {
  // Issue #352: https always, plain http only for this computer (and, in a
  // development build with the developer option on, anywhere) — see
  // shared/companion-config.ts's checkCompanionUrl.
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

export async function resetCustomCompanionUrl(bridge: PopupBridge): Promise<void> {
  log('COMPANION_URL_OVERRIDE reset');
  await resetCompanionUrlOverride();
  bridge.setState(STATES.CHECKING_COMPANION);
  await checkCompanion(bridge);
}

// robots.txt is fetched by the content script (same origin as the page); the panel only relays the request through the
// service worker, like GET_LOGS.
export async function checkRobotsTxt(bridge: PopupBridge): Promise<void> {
  log('ROBOTS_TXT_CHECK start');
  bridge.patchState({ robotsTxtChecking: true, robotsTxtResult: null });
  try {
    const result: RobotsTxtResult = await chrome.runtime.sendMessage({ type: 'CHECK_ROBOTS_TXT' }); // the content script's answer, relayed by the service worker
    log('ROBOTS_TXT_CHECK result', result);
    bridge.patchState({ robotsTxtChecking: false, robotsTxtResult: result });
  } catch (err) {
    log('ROBOTS_TXT_CHECK failed', (err as Error).message);
    bridge.patchState({ robotsTxtChecking: false, robotsTxtResult: { ok: false, error: (err as Error).message } });
  }
}

// The companion generates and runs the script against the live page and answers 422 when that fails (page unreachable, an
// exception, or no data). `data` is logged separately so it reaches a bug report.
export function buildVerificationErrorMessage(data: { error?: string } | null | undefined): string {
  return data?.error || t('toast.verificationFailed');
}

// Shows a failed Generate: a recognised failure gets a plain-language title and hint with the original text behind
// "Details", anything else keeps the raw wording. `reportable` = whether "Report bug" is offered (false for a
// configuration the user can fix). The raw text always goes into a bug report.
function showGenerateFailure(rawMessage: string, { engine, reportable, fallbackKey }: { engine: string; reportable: boolean; fallbackKey: string }): void {
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
export async function resolveCombinedComponents(components: CombinedComponentRef[]): Promise<SFDraft.CombinedComponent[]> {
  const resolved: SFDraft.CombinedComponent[] = [];
  for (const component of components) {
    const res = await companionFetch(`${getResolvedCompanionUrl()}/configs/${component.savedConfigId}`);
    if (!res.ok) throw new Error(t('toast.combinedComponentUnresolvable', { name: component.name }));
    const record: { config: SFWire.ScrapingConfig } = await res.json(); // GET /configs/{id}
    resolved.push({ name: component.name, config: record.config, savedConfigId: component.savedConfigId });
  }
  return resolved;
}

export async function generate(bridge: PopupBridge): Promise<void> {
  hideToast(); // a failure from the previous attempt (Issue #401: those stay until closed)
  bridge.stopPreviewIfActive();
  bridge.setState(STATES.GENERATING);
  const state = bridge.getState();

  let combinedComponents: SFDraft.CombinedComponent[] | null = null;
  if (state.mode === 'combined') {
    try {
      combinedComponents = await resolveCombinedComponents(state.combinedComponents || []);
    } catch (err) {
      log('GENERATE COMBINED RESOLVE FAIL', (err as Error).message);
      bridge.setState(STATES.IDLE);
      showToast(t('toast.generationError', { message: (err as Error).message }), 'Script generation');
      return;
    }
  }

  // Issue-driven follow-up: outputAsJson/includeDataPreview/includeOutputFile/
  // externalConfig moved from per-scrape _state to the cross-session global
  // Settings tab (shared/global-settings.ts) — read from there now.
  const globalSettings = getGlobalSettings();
  const config = buildScrapingConfig(configOptionsFromState(state, globalSettings, { combinedComponents }));
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
      const data: { error?: string } | null = await res.json().catch(() => null);
      log('GENERATE CONFIG INVALID', data);
      bridge.setState(STATES.IDLE);
      showGenerateFailure(data?.error || t('toast.verificationFailed'), { engine: state.engine, reportable: false, fallbackKey: 'toast.configInvalid' });
      return;
    }
    if (res.status === 422) {
      const data: { error?: string } | null = await res.json().catch(() => null);
      log('GENERATE VERIFICATION FAIL', data);
      throw new Error(buildVerificationErrorMessage(data));
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // The verification-skipped header exists for either body shape; shown as a warning (the companion's English text as is, not
    // i18n) since the script itself was generated.
    const verificationSkippedReason = res.headers?.get('X-ScrapingFactory-Verification-Skipped');

    // Only when a preview or output file was requested is the response a JSON envelope ({ script, preview, outputFile }); the
    // client knows which it asked for, so no Content-Type sniffing.
    let scriptText: string;
    let dataPreview: DataPreview | null = null;
    let outputFile: OutputFileContent | null = null;
    let blocksOutput: BlockOutput[] | null = null;
    if (globalSettings.includeDataPreview || globalSettings.includeOutputFile) {
      const data: GenerateEnvelope = await res.json();
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
    log('GENERATE FAIL', (err as Error).message);
    bridge.setState(STATES.IDLE);
    showGenerateFailure((err as Error).message, { engine: state.engine, reportable: true, fallbackKey: 'toast.generationError' });
  }
}

// Called from render() only on COMPANION_ERROR: fills in the resolved companion URL and seeds the override input (blank when it
// is still the default, so the placeholder shows).
export function renderCompanionErrorScreen(): void {
  const currentUrlEl = document.getElementById('error-current-url');
  if (currentUrlEl) currentUrlEl.textContent = t('error.currentUrl', { url: getResolvedCompanionUrl() || DEFAULT_COMPANION_URL });
  const urlInput = document.getElementById('input-companion-url') as HTMLInputElement | null;
  const resolvedUrl = getResolvedCompanionUrl();
  if (urlInput && !urlInput.value) urlInput.value = resolvedUrl && resolvedUrl !== DEFAULT_COMPANION_URL ? resolvedUrl : '';
}

export function wireCompanionErrorEvents(bridge: PopupBridge): void {
  document.getElementById('btn-retry')?.addEventListener('click', () => {
    log('BTN retry');
    bridge.setState(STATES.CHECKING_COMPANION);
    checkCompanion(bridge);
  });

  document.getElementById('btn-use-companion-url')?.addEventListener('click', () => {
    log('BTN use-companion-url');
    const input = document.getElementById('input-companion-url') as HTMLInputElement | null;
    useCustomCompanionUrl(bridge, input?.value || '');
  });

  document.getElementById('btn-reset-companion-url')?.addEventListener('click', () => {
    log('BTN reset-companion-url');
    resetCustomCompanionUrl(bridge);
  });
}
