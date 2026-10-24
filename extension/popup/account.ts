// Issue #352: the extension side of the companion's self-service accounts —
// pure request/response helpers for /auth/register, /auth/login, /auth/logout,
// /auth/logout-all and /auth/change-password (DOM and state live in
// account-ui.ts). `fetchFn` is companionFetch (adds the Bearer token), and
// `baseUrl` the resolved companion address, both passed in so this file needs
// no other module.
//
// Every function resolves to { ok: true, ... } or { ok: false, status, error,
// retryAfter }: `status` is 0 when the companion could not be reached, `error`
// is the companion's own English message (null if it sent none) and
// `retryAfter` the seconds of a 429 throttle response.
const DEVICE_LABEL = 'Browser extension';

// companionFetch (which adds the access key) as well as a plain fetch or a test fake.
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface RequestSuccess {
  ok: true;
  status: number;
  data: unknown;
}

export interface RequestFailure {
  ok: false;
  status: number;
  error: string | null;
  retryAfter: number;
  /** Set by email-account.ts when the typed code is malformed and no request was made. */
  invalidCode?: boolean;
}

export type RequestResult = RequestSuccess | RequestFailure;

export interface AuthSuccess {
  ok: true;
  name: string;
  token: string;
  email: string | null;
  emailVerified: boolean;
  verificationSent: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

async function post(fetchFn: FetchFn, url: string, body: unknown): Promise<RequestResult> {
  let response: Response;
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
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      // 204 No Content (logout, password change) has no body.
    }
    return { ok: true, status: response.status, data };
  }
  let error: string | null = null;
  try {
    const data = asRecord(await response.json());
    if (typeof data.error === 'string') error = data.error;
  } catch {
    // not a JSON error body
  }
  const retryAfter = Number(response.headers?.get?.('Retry-After')) || 0;
  return { ok: false, status: response.status, error, retryAfter };
}

// mode: 'login' | 'register'. On success `token` is the per-device token to
// store as the access key.
// `email` is only sent when registering (Issue #353) and only if given.
async function authenticate(
  fetchFn: FetchFn, baseUrl: string, mode: 'login' | 'register', name: unknown, password: unknown, email?: unknown,
): Promise<AuthSuccess | RequestFailure> {
  const body: Record<string, string> = {
    name: String(name || '').trim(),
    password: String(password || ''),
    device: DEVICE_LABEL,
  };
  if (mode === 'register' && String(email || '').trim()) body.email = String(email).trim();
  const result = await post(fetchFn, `${baseUrl}/auth/${mode === 'register' ? 'register' : 'login'}`, body);
  if (!result.ok) return result;
  const data = asRecord(result.data);
  const token = typeof data.token === 'string' ? data.token : '';
  if (!token) return { ok: false, status: result.status, error: null, retryAfter: 0 };
  return {
    ok: true,
    name: data.name as string, // the companion's own response
    token,
    email: typeof data.email === 'string' ? data.email : null,
    emailVerified: data.emailVerified === true,
    verificationSent: data.verificationSent === true,
  };
}

function signOut(fetchFn: FetchFn, baseUrl: string): Promise<RequestResult> {
  return post(fetchFn, `${baseUrl}/auth/logout`, {});
}

function signOutEverywhere(fetchFn: FetchFn, baseUrl: string): Promise<RequestResult> {
  return post(fetchFn, `${baseUrl}/auth/logout-all`, {});
}

function changePassword(fetchFn: FetchFn, baseUrl: string, currentPassword: unknown, newPassword: unknown): Promise<RequestResult> {
  return post(fetchFn, `${baseUrl}/auth/change-password`, {
    currentPassword: String(currentPassword || ''),
    newPassword: String(newPassword || ''),
  });
}

// The "repeat password" box guards a typo that would lock the user out of a
// brand-new account (there is no password reset yet). 'ok' or a reason key.
function checkRegistrationInput(name: unknown, password: string, repeat: string): 'ok' | 'nameMissing' | 'passwordMissing' | 'passwordMismatch' {
  if (!String(name || '').trim()) return 'nameMissing';
  if (!password) return 'passwordMissing';
  if (password !== repeat) return 'passwordMismatch';
  return 'ok';
}

export { post as request, authenticate, signOut, signOutEverywhere, changePassword, checkRegistrationInput };

