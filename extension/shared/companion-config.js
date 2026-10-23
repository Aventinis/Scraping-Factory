// Resolves which companion base URL the popup talks to, and lets the user override it when the default is not reachable (custom
// Companion:Port, or another host).
const { isDevelopmentBuild } = require('./build-config');

// Mirrors CompanionHostOptions' default; the two are independent constants kept in sync by hand.
const DEFAULT_COMPANION_URL = 'http://localhost:5000';
const STORAGE_KEY = 'companionUrlOverride';

// chrome.storage.local (not .session): a manually entered address is a device preference that should survive a browser restart.
async function getStoredOverride() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return typeof stored[STORAGE_KEY] === 'string' && stored[STORAGE_KEY] ? stored[STORAGE_KEY] : null;
  } catch {
    return null;
  }
}

// Which companion addresses the extension will talk to. Passwords and access keys travel over this connection, so https:// is always fine;
// plain http:// only for this computer (localhost, 127.x, ::1); plain http:// to another host only in a development build with the developer
// option on (a release build has none, and a stored value cannot enable it). Trusting a self-signed certificate is the browser's decision:
// in development, open the companion URL once in a tab and accept it.
function isLoopbackHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host);
}

const DEV_ALLOW_INSECURE_KEY = 'devAllowInsecureHttp';
let cachedAllowInsecure = false;

// Always false in a release build, whatever is stored.
function isInsecureHttpAllowed() {
  return isDevelopmentBuild() && cachedAllowInsecure;
}

async function loadDeveloperOptions() {
  if (!isDevelopmentBuild() || typeof chrome === 'undefined' || !chrome.storage?.local) {
    cachedAllowInsecure = false;
    return;
  }
  try {
    const stored = await chrome.storage.local.get(DEV_ALLOW_INSECURE_KEY);
    cachedAllowInsecure = stored[DEV_ALLOW_INSECURE_KEY] === true;
  } catch {
    cachedAllowInsecure = false;
  }
}

// Ignored (stays off) in a release build.
async function setInsecureHttpAllowed(allowed) {
  cachedAllowInsecure = isDevelopmentBuild() && allowed === true;
  if (!isDevelopmentBuild() || typeof chrome === 'undefined' || !chrome.storage?.local) return;
  try {
    await chrome.storage.local.set({ [DEV_ALLOW_INSECURE_KEY]: cachedAllowInsecure });
  } catch {
    // Best-effort, like the other preferences.
  }
}

// { ok: true, url } or { ok: false, reason: 'invalid' | 'insecure' }.
function checkCompanionUrl(raw) {
  const normalized = normalizeUrl(raw);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (parsed.protocol === 'https:') return { ok: true, url: normalized };
  if (parsed.protocol !== 'http:') return { ok: false, reason: 'invalid' };
  if (isLoopbackHostname(parsed.hostname) || isInsecureHttpAllowed()) return { ok: true, url: normalized };
  return { ok: false, reason: 'insecure' };
}

async function getCompanionUrl() {
  const override = await getStoredOverride();
  // A stored address that the current policy no longer allows (e.g. saved by
  // a development build) falls back to the default instead of being used.
  return override && checkCompanionUrl(override).ok ? normalizeUrl(override) : DEFAULT_COMPANION_URL;
}

// Strips a trailing slash so callers can always append "/health"/"/generate"
// the same way regardless of whether the user typed one.
function normalizeUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

async function setCompanionUrlOverride(url) {
  const normalized = normalizeUrl(url);
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return normalized;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
  } catch {
    // Best-effort — a failed write just means the override won't survive a restart.
  }
  return normalized;
}

async function resetCompanionUrlOverride() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  try {
    await chrome.storage.local.remove(STORAGE_KEY);
  } catch {
    // Best-effort, same as setCompanionUrlOverride above.
  }
}

// The access key for a companion with authentication on: a device preference (chrome.storage.local). Read synchronously from a
// module-level cache (loadAccessKey() fills it, setAccessKey() refreshes it) because every companion request needs it; sent as
// `Authorization: Bearer <key>` (companionFetch). Never logged.
const ACCESS_KEY_STORAGE_KEY = 'companionAccessKey';
let cachedAccessKey = '';

async function loadAccessKey() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return cachedAccessKey;
  try {
    const stored = await chrome.storage.local.get(ACCESS_KEY_STORAGE_KEY);
    cachedAccessKey = typeof stored[ACCESS_KEY_STORAGE_KEY] === 'string' ? stored[ACCESS_KEY_STORAGE_KEY] : '';
  } catch {
    cachedAccessKey = '';
  }
  return cachedAccessKey;
}

function getAccessKey() {
  return cachedAccessKey;
}

// An empty key clears it.
async function setAccessKey(key) {
  cachedAccessKey = String(key || '').trim();
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return cachedAccessKey;
  try {
    if (cachedAccessKey) await chrome.storage.local.set({ [ACCESS_KEY_STORAGE_KEY]: cachedAccessKey });
    else await chrome.storage.local.remove(ACCESS_KEY_STORAGE_KEY);
  } catch {
    // Best-effort — a failed write just means the key won't survive a restart.
  }
  return cachedAccessKey;
}

module.exports = {
  DEFAULT_COMPANION_URL,
  isLoopbackHostname,
  checkCompanionUrl,
  isInsecureHttpAllowed,
  loadDeveloperOptions,
  setInsecureHttpAllowed,
  loadAccessKey,
  getAccessKey,
  setAccessKey,
  getCompanionUrl,
  setCompanionUrlOverride,
  resetCompanionUrlOverride,
  normalizeUrl,
};

