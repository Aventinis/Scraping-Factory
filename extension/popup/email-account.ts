// Issue #353: the extension side of the companion's email features — confirming
// an address with a mailed code, changing it, and resetting a forgotten
// password. Pure request/response helpers (DOM and state live in
// email-account-ui.js); `fetchFn` is companionFetch and `baseUrl` the resolved
// companion address, passed in like account.ts does. Same result shape:
// { ok: true, ... } or { ok: false, status, error, retryAfter }.
import { request } from './account';
import type { FetchFn, RequestFailure, RequestResult } from './account';

// The codes the companion mails are 8 digits; people type them with spaces.
export const CODE_DIGITS = 8;

export interface SetEmailSuccess {
  ok: true;
  email: string | null;
  emailVerified: boolean;
  verificationSent: boolean;
}

export function normalizeCode(typed: unknown): string | null {
  const digits = String(typed || '').replace(/[\s-]/g, '');
  return /^\d+$/.test(digits) && digits.length === CODE_DIGITS ? digits : null;
}

export async function verifyEmail(fetchFn: FetchFn, baseUrl: string, code: unknown): Promise<RequestResult> {
  const normalized = normalizeCode(code);
  if (!normalized) return { ok: false, status: 400, error: null, retryAfter: 0, invalidCode: true };
  return request(fetchFn, `${baseUrl}/auth/verify-email`, { code: normalized });
}

export function resendVerification(fetchFn: FetchFn, baseUrl: string): Promise<RequestResult> {
  return request(fetchFn, `${baseUrl}/auth/resend-verification`, {});
}

export async function setEmail(fetchFn: FetchFn, baseUrl: string, email: unknown, currentPassword: unknown): Promise<SetEmailSuccess | RequestFailure> {
  const result = await request(fetchFn, `${baseUrl}/auth/set-email`, {
    email: String(email || '').trim(),
    currentPassword: String(currentPassword || ''),
  });
  if (!result.ok) return result;
  const data = (result.data ?? {}) as Record<string, unknown>; // the companion's own response
  return {
    ok: true,
    email: typeof data.email === 'string' ? data.email : null,
    emailVerified: data.emailVerified === true,
    verificationSent: data.verificationSent === true,
  };
}

// `account` is a user name or the account's verified email address.
export function forgotPassword(fetchFn: FetchFn, baseUrl: string, account: unknown): Promise<RequestResult> {
  return request(fetchFn, `${baseUrl}/auth/forgot-password`, { account: String(account || '').trim() });
}

export async function resetPassword(fetchFn: FetchFn, baseUrl: string, account: unknown, code: unknown, newPassword: unknown): Promise<RequestResult> {
  const normalized = normalizeCode(code);
  if (!normalized) return { ok: false, status: 400, error: null, retryAfter: 0, invalidCode: true };
  return request(fetchFn, `${baseUrl}/auth/reset-password`, {
    account: String(account || '').trim(),
    code: normalized,
    newPassword: String(newPassword || ''),
  });
}

// Cheap client-side check before bothering the companion; the real validation is its.
export function looksLikeEmail(value: unknown): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

