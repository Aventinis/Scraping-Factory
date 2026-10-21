// Issue #352: the extension side of the companion's self-service accounts —
// pure request/response helpers for /auth/register, /auth/login, /auth/logout,
// /auth/logout-all and /auth/change-password (DOM and state live in
// account-ui.js). `fetchFn` is companionFetch (adds the Bearer token), and
// `baseUrl` the resolved companion address, both passed in so this file needs
// no other module.
//
// Every function resolves to { ok: true, ... } or { ok: false, status, error,
// retryAfter }: `status` is 0 when the companion could not be reached, `error`
// is the companion's own English message (null if it sent none) and
// `retryAfter` the seconds of a 429 throttle response.
const SFAccount = (function () {
  const DEVICE_LABEL = 'Browser extension';

  async function post(fetchFn, url, body) {
    let response;
    try {
      response = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0, error: null, retryAfter: 0 };
    }
    if (response.ok) {
      let data = null;
      try {
        data = await response.json();
      } catch {
        // 204 No Content (logout, password change) has no body.
      }
      return { ok: true, status: response.status, data };
    }
    let error = null;
    try {
      const data = await response.json();
      if (typeof data?.error === 'string') error = data.error;
    } catch {
      // not a JSON error body
    }
    const retryAfter = Number(response.headers?.get?.('Retry-After')) || 0;
    return { ok: false, status: response.status, error, retryAfter };
  }

  // mode: 'login' | 'register'. On success `token` is the per-device token to
  // store as the access key.
  // `email` is only sent when registering (Issue #353) and only if given.
  async function authenticate(fetchFn, baseUrl, mode, name, password, email) {
    const body = {
      name: String(name || '').trim(),
      password: String(password || ''),
      device: DEVICE_LABEL,
    };
    if (mode === 'register' && String(email || '').trim()) body.email = String(email).trim();
    const result = await post(fetchFn, `${baseUrl}/auth/${mode === 'register' ? 'register' : 'login'}`, body);
    if (!result.ok) return result;
    const token = typeof result.data?.token === 'string' ? result.data.token : '';
    if (!token) return { ok: false, status: result.status, error: null, retryAfter: 0 };
    return {
      ok: true,
      name: result.data.name,
      token,
      email: typeof result.data.email === 'string' ? result.data.email : null,
      emailVerified: result.data.emailVerified === true,
      verificationSent: result.data.verificationSent === true,
    };
  }

  function signOut(fetchFn, baseUrl) {
    return post(fetchFn, `${baseUrl}/auth/logout`, {});
  }

  function signOutEverywhere(fetchFn, baseUrl) {
    return post(fetchFn, `${baseUrl}/auth/logout-all`, {});
  }

  function changePassword(fetchFn, baseUrl, currentPassword, newPassword) {
    return post(fetchFn, `${baseUrl}/auth/change-password`, {
      currentPassword: String(currentPassword || ''),
      newPassword: String(newPassword || ''),
    });
  }

  // The "repeat password" box guards a typo that would lock the user out of a
  // brand-new account (there is no password reset yet). 'ok' or a reason key.
  function checkRegistrationInput(name, password, repeat) {
    if (!String(name || '').trim()) return 'nameMissing';
    if (!password) return 'passwordMissing';
    if (password !== repeat) return 'passwordMismatch';
    return 'ok';
  }

  return { request: post, authenticate, signOut, signOutEverywhere, changePassword, checkRegistrationInput };
})();

if (typeof module !== 'undefined') module.exports = SFAccount;
if (typeof self !== 'undefined') self.SFAccount = SFAccount;
