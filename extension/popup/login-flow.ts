// The "Login form" starter and plain-unit helpers for the browser actions: pure (browser-actions-ui.ts renders them). A login is
// built from the generic WaitFor / Fill / Click / Scroll actions; the starter adds the four typical steps at once so the user only
// clicks the four elements. Each starter action carries a UI-only `role` (the card then says "Fill in the user name"); the
// serializer picks the wire fields per kind, so a role never reaches the request.

import type * as SFDraft from '../types/drafts';

export const LOGIN_FLOW_ROLES: SFDraft.BrowserActionRole[] = ['user', 'password', 'submit', 'loggedIn'];

// Suggested names of environment variables on the computer that runs the script.
export const LOGIN_FLOW_USER_ENV = 'SITE_USERNAME';
export const LOGIN_FLOW_PASSWORD_ENV = 'SITE_PASSWORD';
// Login pages are often slow: 10 s instead of the generic WaitFor's 5 s.
export const LOGIN_FLOW_WAIT_MS = 10000;

/** `base` if no Fill action uses it yet, else base_2, base_3, ...: two starters never read the same variable. */
function uniqueEnvName(base: string, actions: SFDraft.BrowserAction[]): string {
  const used = new Set(actions.filter((a) => a.kind === 'fill').map((a) => (a.environmentVariableName || '').trim()));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

/**
 * Appends the four login steps (never replaces what is there): Fill (user name), Fill (password), Click (login button), WaitFor
 * (until the logged-in page appears). Selectors stay empty for the user to pick; the variable names are prefilled.
 */
export function addLoginFlow(actions: SFDraft.BrowserAction[]): SFDraft.BrowserAction[] {
  const userEnv = uniqueEnvName(LOGIN_FLOW_USER_ENV, actions);
  const passwordEnv = uniqueEnvName(LOGIN_FLOW_PASSWORD_ENV, actions);
  return [
    ...actions,
    { kind: 'fill', selector: '', environmentVariableName: userEnv, role: 'user' },
    { kind: 'fill', selector: '', environmentVariableName: passwordEnv, role: 'password' },
    { kind: 'click', selector: '', target: 'first', waitAfterMs: 250, role: 'submit' },
    { kind: 'waitFor', selector: '', timeoutMs: LOGIN_FLOW_WAIT_MS, role: 'loggedIn' },
  ];
}

/** Milliseconds (stored and sent) to the seconds text shown to the user: 5000 -> "5", 250 -> "0.25". */
export function msToSecondsText(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '';
  return String(Math.round(ms) / 1000);
}

/** The seconds text a user typed to whole milliseconds; a decimal comma works. Anything unusable gives `fallbackMs`. */
export function secondsTextToMs(text: string, fallbackMs: number, options: { allowZero?: boolean } = {}): number {
  const parsed = Number(String(text ?? '').trim().replace(',', '.'));
  if (!String(text ?? '').trim() || !Number.isFinite(parsed)) return fallbackMs;
  const ms = Math.round(parsed * 1000);
  if (ms < 0 || (ms === 0 && !options.allowZero)) return fallbackMs;
  return ms;
}
