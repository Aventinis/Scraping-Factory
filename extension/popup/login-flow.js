// @ts-check
// "Login form" starter and plain-unit helpers for the browser actions
// (Issue #403) — pure data/logic only, no DOM (see browser-actions-ui.js for
// the rendering).
//
// A login is built from the generic WaitFor/Fill/Click/Scroll actions; the
// starter adds the four steps a typical login consists of in one go, so the
// user only has to click the four elements on the page. Each starter action
// carries a UI-only `role` (the card then says "Fill in the user name"
// instead of a bare "Fill"); serializeBrowserActions picks the wire fields
// per kind, so a role never reaches the request body.

/** @type {SFDraft.BrowserActionRole[]} */
const LOGIN_FLOW_ROLES = ['user', 'password', 'submit', 'loggedIn'];

// Variable names suggested by the starter (Issue #397's wording: the
// *name* of an environment variable on the computer that runs the script).
const LOGIN_FLOW_USER_ENV = 'SITE_USERNAME';
const LOGIN_FLOW_PASSWORD_ENV = 'SITE_PASSWORD';
// Login pages are often slow; 10 s instead of the generic WaitFor's 5 s.
const LOGIN_FLOW_WAIT_MS = 10000;

/**
 * `base` if no existing Fill action uses it, else base_2, base_3, … — so
 * adding a second starter never makes two actions read the same variable.
 * @param {string} base
 * @param {SFDraft.BrowserAction[]} actions
 */
function uniqueEnvName(base, actions) {
  const used = new Set(actions.filter((a) => a.kind === 'fill').map((a) => (a.environmentVariableName || '').trim()));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

/**
 * Appends the four login steps (never replaces what is already there):
 * Fill (user name), Fill (password), Click (login button), WaitFor (until
 * the logged-in page appears). The selectors are left empty for the user to
 * pick; the variable names are prefilled so the rows are valid at once.
 * @param {SFDraft.BrowserAction[]} actions
 * @returns {SFDraft.BrowserAction[]}
 */
function addLoginFlow(actions) {
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

/**
 * Milliseconds (stored/sent) → the seconds text shown to the user:
 * 5000 → "5", 250 → "0.25".
 * @param {number | null | undefined} ms
 */
function msToSecondsText(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '';
  return String(Math.round(ms) / 1000);
}

/**
 * The seconds text a user typed → whole milliseconds. A decimal comma works
 * ("0,5"); anything unusable (blank, not a number, negative, or zero where
 * zero makes no sense) gives `fallbackMs`.
 * @param {string} text
 * @param {number} fallbackMs
 * @param {{ allowZero?: boolean }} [options]
 */
function secondsTextToMs(text, fallbackMs, options = {}) {
  const parsed = Number(String(text ?? '').trim().replace(',', '.'));
  if (!String(text ?? '').trim() || !Number.isFinite(parsed)) return fallbackMs;
  const ms = Math.round(parsed * 1000);
  if (ms < 0 || (ms === 0 && !options.allowZero)) return fallbackMs;
  return ms;
}

module.exports = {
  LOGIN_FLOW_ROLES, LOGIN_FLOW_USER_ENV, LOGIN_FLOW_PASSWORD_ENV, LOGIN_FLOW_WAIT_MS,
  addLoginFlow, msToSecondsText, secondsTextToMs,
};
