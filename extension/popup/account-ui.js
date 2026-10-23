// Issue #352: the Settings screen's "Account" section (sign in / register /
// sign out / change password against the companion's /auth endpoints) and,
// in a development build only, the "Developer options" section. Same
// `bridge`-parameter convention as every other -ui module; the request logic
// itself is in account.ts.
const { createLogger } = require('../shared/logger');
const log = createLogger('SF:Popup');

const { getAccessKey, setAccessKey, isInsecureHttpAllowed, setInsecureHttpAllowed } =
  require('../shared/companion-config');
const { isDevelopmentBuild } = require('../shared/build-config');
const { t } = require('../i18n/i18n');
const { showToast } = require('./toast');
const { autoOpenAdvanced } = require('./advanced-disclosure-ui');
const { getResolvedCompanionUrl, getCompanionInfo, companionFetch } = require('./companion-client');
const account = require('./account');
const { looksLikeEmail } = require('./email-account');

// Who the companion says we are right now (name '' = nobody / not asked yet),
// and — Issue #353 — the state of that account's email address. Shared with
// email-account-ui.js through getAccountState()/setAccountState().
let acct = { name: '', email: null, emailVerified: false };

const getAccountState = () => acct;
const setAccountState = (patch) => { acct = { ...acct, ...patch }; };

const byId = (id) => document.getElementById(id);
const value = (id) => /** @type {HTMLInputElement | null} */ (byId(id))?.value ?? '';
const clear = (...ids) => ids.forEach((id) => {
  const input = /** @type {HTMLInputElement | null} */ (byId(id));
  if (input) input.value = '';
});

function showAccountStatus(text, warn) {
  const status = byId('account-status');
  if (!status) return;
  status.textContent = text;
  status.classList.toggle('hidden', !text);
  status.classList.toggle('warn', Boolean(warn));
}

// The message for a failed request: the companion's own text where it gave
// one (its wording is the same plain English as every companion error), a
// throttle hint for 429, "could not be reached" for status 0.
function describeAccountFailure(result) {
  if (result.status === 0) return t('settings.account.unreachable');
  if (result.status === 429) return t('settings.account.throttled', { seconds: result.retryAfter || 60 });
  return result.error || t('settings.account.failed', { status: result.status });
}

// Asks /whoami whether the stored key/token is good; only a successful answer
// that names a user counts as signed in.
async function refreshSignedInName() {
  acct = { name: '', email: null, emailVerified: false };
  if (!getCompanionInfo().authRequired || !getAccessKey()) return;
  try {
    const response = await companionFetch(`${getResolvedCompanionUrl()}/whoami`);
    if (response.ok) {
      const body = await response.json();
      acct = { name: body?.name || '', email: body?.email || null, emailVerified: body?.emailVerified === true };
    }
  } catch {
    acct = { name: '', email: null, emailVerified: false };
  }
}

function renderAccountSection() {
  const info = getCompanionInfo();
  const section = byId('settings-account-section');
  if (!section) return;
  section.classList.toggle('hidden', !info.authRequired);
  // Issue #354: the connection card is collapsed by default; a companion that asks for a login opens it.
  autoOpenAdvanced(section, info.authRequired && acct.name === '');
  if (!info.authRequired) return;

  const signedIn = acct.name !== '';
  byId('account-signed-out')?.classList.toggle('hidden', signedIn);
  byId('account-signed-in')?.classList.toggle('hidden', !signedIn);
  const who = byId('account-signed-in-as');
  if (who) who.textContent = t('settings.account.signedInAs', { name: acct.name });
  // Register needs the operator to have opened registration, and a repeat box.
  byId('btn-account-register')?.classList.toggle('hidden', !info.registration);
  byId('account-repeat-row')?.classList.toggle('hidden', !info.registration);
  byId('account-no-registration')?.classList.toggle('hidden', info.registration);
}

function renderDeveloperSection() {
  const section = byId('settings-developer-section');
  if (!section) return;
  // A release build has no such section at all — not hidden, removed, so
  // nothing in its markup, state or storage can switch the options on.
  if (!isDevelopmentBuild()) {
    section.remove();
    return;
  }
  const toggle = /** @type {HTMLInputElement | null} */ (byId('toggle-dev-insecure-http'));
  if (toggle) toggle.checked = isInsecureHttpAllowed();
}

function renderAccountAndDeveloperSections() {
  renderAccountSection();
  renderDeveloperSection();
}

// After a sign-in/out everything the companion returns is another user's
// data: re-fetch the lists that depend on it.
function refreshCompanionData(bridge) {
  const url = bridge.getState().url;
  if (url) bridge.fetchSavedConfigs?.(url);
  bridge.fetchAllSavedConfigs?.();
  bridge.fetchOutputBlueprints?.();
  bridge.fetchTransformPresets?.();
}

async function authenticate(bridge, mode) {
  const name = value('input-account-name');
  const password = value('input-account-password');
  if (mode === 'register') {
    const problem = account.checkRegistrationInput(name, password, value('input-account-password-repeat'));
    if (problem !== 'ok') {
      showAccountStatus(t(`settings.account.${problem}`), true);
      return;
    }
  }
  const email = value('input-account-email');
  const emailMode = getCompanionInfo().email;
  if (mode === 'register' && emailMode === 'required' && !email.trim()) {
    showAccountStatus(t('settings.account.emailMissing'), true);
    return;
  }
  if (mode === 'register' && email.trim() && !looksLikeEmail(email)) {
    showAccountStatus(t('settings.account.emailInvalid'), true);
    return;
  }
  const result = await account.authenticate(companionFetch, getResolvedCompanionUrl(), mode, name, password, email);
  if (!result.ok) {
    showAccountStatus(describeAccountFailure(result), true);
    return;
  }
  await setAccessKey(result.token);
  clear('input-account-password', 'input-account-password-repeat');
  acct = { name: result.name, email: result.email, emailVerified: result.emailVerified };
  clear('input-account-email');
  // A fresh address has to be confirmed: say where the code went.
  showAccountStatus(
    mode === 'register' && result.email
      ? t(result.verificationSent ? 'settings.account.registeredCodeSent' : 'settings.account.registeredNoCode', { email: result.email })
      : '',
    mode === 'register' && Boolean(result.email) && !result.verificationSent);
  bridge.patchState({});
  refreshCompanionData(bridge);
}

async function endSession(bridge, everywhere) {
  const result = everywhere
    ? await account.signOutEverywhere(companionFetch, getResolvedCompanionUrl())
    : await account.signOut(companionFetch, getResolvedCompanionUrl());
  // Whatever the companion answered, this browser forgets the token: signing
  // out must work even when the companion can't be reached or already
  // revoked it.
  await setAccessKey('');
  acct = { name: '', email: null, emailVerified: false };
  // A failed "everywhere" matters (other devices stay signed in); a failed
  // plain sign-out doesn't (the token only lives on, unused, on the companion).
  const everywhereFailed = everywhere && !result.ok;
  showAccountStatus(everywhereFailed ? describeAccountFailure(result) : '', everywhereFailed);
  bridge.patchState({});
  refreshCompanionData(bridge);
}

async function changePassword() {
  const result = await account.changePassword(
    companionFetch, getResolvedCompanionUrl(), value('input-account-current-password'), value('input-account-new-password'));
  if (!result.ok) {
    showAccountStatus(describeAccountFailure(result), true);
    return;
  }
  clear('input-account-current-password', 'input-account-new-password');
  showAccountStatus(t('settings.account.passwordChanged'), false);
}

function wireAccountAndDeveloperEvents(bridge) {
  // Opening Settings asks who we are, so the section shows the real state.
  byId('btn-open-settings')?.addEventListener('click', async () => {
    await refreshSignedInName();
    bridge.patchState({});
  });
  byId('btn-account-login')?.addEventListener('click', () => { log('BTN account-login'); authenticate(bridge, 'login'); });
  byId('btn-account-register')?.addEventListener('click', () => { log('BTN account-register'); authenticate(bridge, 'register'); });
  for (const id of ['input-account-name', 'input-account-password']) {
    byId(id)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') authenticate(bridge, 'login'); });
  }
  byId('btn-account-logout')?.addEventListener('click', () => { log('BTN account-logout'); endSession(bridge, false); });
  byId('btn-account-logout-all')?.addEventListener('click', () => { log('BTN account-logout-all'); endSession(bridge, true); });
  byId('btn-account-change-password')?.addEventListener('click', () => { log('BTN account-change-password'); changePassword(); });

  // Development build only (the section does not exist in a release build,
  // and setInsecureHttpAllowed ignores the call there anyway).
  byId('toggle-dev-insecure-http')?.addEventListener('change', async (e) => {
    await setInsecureHttpAllowed(e.target.checked);
    showToast(t('settings.developer.reloadHint'), null, 'info');
  });
  byId('btn-dev-open-companion')?.addEventListener('click', () => {
    const url = getResolvedCompanionUrl();
    if (url && typeof chrome !== 'undefined' && chrome.tabs?.create) chrome.tabs.create({ url: `${url}/health` });
  });
}

module.exports = {
  renderAccountAndDeveloperSections, wireAccountAndDeveloperEvents,
  getAccountState, setAccountState, showAccountStatus, describeAccountFailure, refreshSignedInName, refreshCompanionData,
};

