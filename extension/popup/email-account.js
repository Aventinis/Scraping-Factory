// Issue #353: the extension side of the companion's email features — confirming
// an address with a mailed code, changing it, and resetting a forgotten
// password. Pure request/response helpers (DOM and state live in
// email-account-ui.js); `fetchFn` is companionFetch and `baseUrl` the resolved
// companion address, passed in like account.js does. Same result shape:
// { ok: true, ... } or { ok: false, status, error, retryAfter }.
const { request } = require('./account');

// The codes the companion mails are 8 digits; people type them with spaces.
const CODE_DIGITS = 8;

function normalizeCode(typed) {
  const digits = String(typed || '').replace(/[\s-]/g, '');
  return /^\d+$/.test(digits) && digits.length === CODE_DIGITS ? digits : null;
}

async function verifyEmail(fetchFn, baseUrl, code) {
  const normalized = normalizeCode(code);
  if (!normalized) return { ok: false, status: 400, error: null, retryAfter: 0, invalidCode: true };
  return request(fetchFn, `${baseUrl}/auth/verify-email`, { code: normalized });
}

function resendVerification(fetchFn, baseUrl) {
  return request(fetchFn, `${baseUrl}/auth/resend-verification`, {});
}

async function setEmail(fetchFn, baseUrl, email, currentPassword) {
  const result = await request(fetchFn, `${baseUrl}/auth/set-email`, {
    email: String(email || '').trim(),
    currentPassword: String(currentPassword || ''),
  });
  if (!result.ok) return result;
  return {
    ok: true,
    email: typeof result.data?.email === 'string' ? result.data.email : null,
    emailVerified: result.data?.emailVerified === true,
    verificationSent: result.data?.verificationSent === true,
  };
}

// `account` is a user name or the account's verified email address.
function forgotPassword(fetchFn, baseUrl, account) {
  return request(fetchFn, `${baseUrl}/auth/forgot-password`, { account: String(account || '').trim() });
}

async function resetPassword(fetchFn, baseUrl, account, code, newPassword) {
  const normalized = normalizeCode(code);
  if (!normalized) return { ok: false, status: 400, error: null, retryAfter: 0, invalidCode: true };
  return request(fetchFn, `${baseUrl}/auth/reset-password`, {
    account: String(account || '').trim(),
    code: normalized,
    newPassword: String(newPassword || ''),
  });
}

// Cheap client-side check before bothering the companion; the real validation is its.
function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

module.exports = { CODE_DIGITS, normalizeCode, verifyEmail, resendVerification, setEmail, forgotPassword, resetPassword, looksLikeEmail };

