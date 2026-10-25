// Issue #353: the email parts of the Settings screen's Account section —
// the address field at registration, the "verify your email" box with the code
// the companion mailed, changing the address, and "Forgot password?". Request
// logic is in email-account.ts; the signed-in state is shared with
// account-ui.ts. Same `bridge`-parameter convention as every other -ui module.
import type { PopupBridge } from '../types/popup';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import { getResolvedCompanionUrl, getCompanionInfo, companionFetch } from './companion-client';
import * as email from './email-account';
import { getAccountState, setAccountState, showAccountStatus, describeAccountFailure, refreshCompanionData } from './account-ui';
import { byIdOrNull } from './dom';

const log = createLogger('SF:Popup');

const value = (id: string): string => byIdOrNull<HTMLInputElement>(id)?.value ?? '';
const clear = (...ids: string[]): void => ids.forEach((id) => {
  const input = byIdOrNull<HTMLInputElement>(id);
  if (input) input.value = '';
});
// The companion address is resolved by the health check before any account screen can be used.
const base = (): string => getResolvedCompanionUrl() as string;

export function renderEmailAccountSection(): void {
  const info = getCompanionInfo();
  const account = getAccountState();
  const emailOn = info.email !== 'off';

  // Signed out: the address field at registration (only when registering is possible), "Forgot password?".
  byIdOrNull('account-email-row')?.classList.toggle('hidden', !(emailOn && info.registration));
  const label = byIdOrNull('label-account-email');
  if (label) label.textContent = t(info.email === 'required' ? 'settings.account.emailLabelRequired' : 'settings.account.emailLabelOptional');
  byIdOrNull('btn-account-forgot')?.classList.toggle('hidden', !info.passwordReset);
  if (!info.passwordReset) byIdOrNull('account-forgot-panel')?.classList.add('hidden');

  // Signed in: the address, its state, the code box.
  byIdOrNull('account-email-section')?.classList.toggle('hidden', !emailOn);
  const state = byIdOrNull('account-email-state');
  if (state) {
    state.textContent = !account.email
      ? t('settings.account.noEmail')
      : t(account.emailVerified ? 'settings.account.emailVerifiedState' : 'settings.account.emailUnverifiedState', { email: account.email });
  }
  byIdOrNull('account-verify-row')?.classList.toggle('hidden', !(account.email && !account.emailVerified && info.passwordReset));
}

async function sendResetCode(): Promise<void> {
  const account = value('input-account-forgot-account').trim();
  if (!account) {
    showAccountStatus(t('settings.account.forgotAccountMissing'), true);
    return;
  }
  const result = await email.forgotPassword(companionFetch, base(), account);
  showAccountStatus(result.ok ? t('settings.account.forgotSent') : describeAccountFailure(result), !result.ok);
}

async function confirmReset(bridge: PopupBridge): Promise<void> {
  const account = value('input-account-forgot-account').trim();
  const password = value('input-account-reset-password');
  if (!account) {
    showAccountStatus(t('settings.account.forgotAccountMissing'), true);
    return;
  }
  if (!email.normalizeCode(value('input-account-reset-code'))) {
    showAccountStatus(t('settings.account.codeInvalid', { digits: email.CODE_DIGITS }), true);
    return;
  }
  if (!password) {
    showAccountStatus(t('settings.account.passwordMissing'), true);
    return;
  }
  const result = await email.resetPassword(companionFetch, base(), account, value('input-account-reset-code'), password);
  if (!result.ok) {
    showAccountStatus(describeAccountFailure(result), true);
    return;
  }
  clear('input-account-forgot-account', 'input-account-reset-code', 'input-account-reset-password');
  byIdOrNull('account-forgot-panel')?.classList.add('hidden');
  showAccountStatus(t('settings.account.resetDone'), false);
  bridge.patchState({});
}

async function verify(bridge: PopupBridge): Promise<void> {
  const result = await email.verifyEmail(companionFetch, base(), value('input-account-verify-code'));
  if (!result.ok) {
    showAccountStatus(result.invalidCode ? t('settings.account.codeInvalid', { digits: email.CODE_DIGITS }) : describeAccountFailure(result), true);
    return;
  }
  setAccountState({ emailVerified: true });
  clear('input-account-verify-code');
  showAccountStatus(t('settings.account.emailVerifiedNow'), false);
  bridge.patchState({});
  // With "verified email required" the data was blocked until now.
  refreshCompanionData(bridge);
}

async function resend(): Promise<void> {
  const result = await email.resendVerification(companionFetch, base());
  showAccountStatus(result.ok ? t('settings.account.codeResent') : describeAccountFailure(result), !result.ok);
}

async function changeEmail(bridge: PopupBridge): Promise<void> {
  const address = value('input-account-new-email').trim();
  if (!email.looksLikeEmail(address)) {
    showAccountStatus(t('settings.account.emailInvalid'), true);
    return;
  }
  const result = await email.setEmail(companionFetch, base(), address, value('input-account-email-password'));
  if (!result.ok) {
    showAccountStatus(describeAccountFailure(result), true);
    return;
  }
  setAccountState({ email: result.email, emailVerified: result.emailVerified });
  clear('input-account-new-email', 'input-account-email-password');
  showAccountStatus(
    t(result.verificationSent ? 'settings.account.registeredCodeSent' : 'settings.account.registeredNoCode', { email: result.email }),
    !result.verificationSent);
  bridge.patchState({});
}

export function wireEmailAccountEvents(bridge: PopupBridge): void {
  byIdOrNull('btn-account-forgot')?.addEventListener('click', () => {
    log('BTN account-forgot');
    byIdOrNull('account-forgot-panel')?.classList.toggle('hidden');
  });
  byIdOrNull('btn-account-forgot-send')?.addEventListener('click', () => { log('BTN account-forgot-send'); sendResetCode(); });
  byIdOrNull('btn-account-reset-confirm')?.addEventListener('click', () => { log('BTN account-reset-confirm'); confirmReset(bridge); });
  byIdOrNull('btn-account-verify')?.addEventListener('click', () => { log('BTN account-verify'); verify(bridge); });
  byIdOrNull('input-account-verify-code')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') verify(bridge); });
  byIdOrNull('btn-account-resend')?.addEventListener('click', () => { log('BTN account-resend'); resend(); });
  byIdOrNull('btn-account-set-email')?.addEventListener('click', () => { log('BTN account-set-email'); changeEmail(bridge); });
}
