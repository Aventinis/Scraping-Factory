// Resolves which companion app base URL the popup should talk to, and lets
// the user override it when the default isn't reachable (e.g. the companion
// was started with a custom Companion:Port in its own appsettings.json, or
// is reachable on another host). Same IIFE-wrapped-single-global pattern as
// shared/logger.js and i18n/i18n.js (see their own doc comments) — popup.html
// loads this as a classic <script> alongside those, so a bare top-level
// `const` here would collide with popup.js's own declarations.
const SFCompanionConfig = (function () {
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

  async function getCompanionUrl() {
    const override = await getStoredOverride();
    return override || DEFAULT_COMPANION_URL;
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

  return {
    DEFAULT_COMPANION_URL,
    getCompanionUrl,
    setCompanionUrlOverride,
    resetCompanionUrlOverride,
    normalizeUrl,
  };
})();

if (typeof module !== 'undefined') module.exports = SFCompanionConfig;
if (typeof self !== 'undefined') self.SFCompanionConfig = SFCompanionConfig;
