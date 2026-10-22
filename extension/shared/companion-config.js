// Resolves which companion app base URL the popup should talk to, and lets
// the user override it when the default isn't reachable (e.g. the companion
// was started with a custom Companion:Port in its own appsettings.json, or
// is reachable on another host).
const { isDevelopmentBuild } = require('./build-config');

// Mirrors CompanionHostOptions' own default in the companion app
// (companion/ScrapingFactory.Companion/CompanionHostOptions.cs) — the two
// are independent hardcoded values (different languages, no shared config
// file), so keeping them in sync is a manual convention, not something
// enforced by tooling.
const DEFAULT_COMPANION_URL = 'http://localhost:5000';
const STORAGE_KEY = 'companionUrlOverride';

// chrome.storage.local (not .session, unlike most of the popup's state) —
// a manually-entered companion address is a long-lived device preference
// (same reasoning as i18n's own language choice) that should survive a
// browser restart, not just a popup close/reopen.
async function getStoredOverride() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return typeof stored[STORAGE_KEY] === 'string' && stored[STORAGE_KEY] ? stored[STORAGE_KEY] : null;
  } catch {
    return null;
  }
}

// Issue #352: which companion addresses the extension will talk to. Passwords
// and access keys travel over this connection, so:
//   - https:// is always fine;
//   - plain http:// only for a companion on this computer (localhost, 127.x,
//     ::1) — traffic never leaves the machine;
//   - plain http:// to any other host only in a development build with the
//     developer option switched on (see below). A release build has no such
//     option, and a stored value can't enable it.
// A certificate the browser doesn't trust (a self-signed development
// certificate) is the browser's decision, not the extension's — in
// development, open the companion URL once in a tab and accept it.
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

// Issue #278: the access key for a companion that has per-user
// authentication switched on — a long-lived device preference like the URL
// override above, so chrome.storage.local too. Read synchronously from a
// module-level cache (filled once by loadAccessKey(), refreshed by
// setAccessKey()) because every companion request needs it, not just
// startup; sent as `Authorization: Bearer <key>` (see companionFetch in
// popup/companion-client.js). Never logged.
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

