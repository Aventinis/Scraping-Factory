// Cross-session user preferences, reached from the popup's own dedicated
// Settings tab (extension/popup/global-settings-ui.js) — mirrors
// shared/theme.js's exact pattern (chrome.storage.local, a long-lived device
// preference that should survive a browser restart, not just a popup close/
// reopen; one module-level cache populated once by an async init, synchronous
// reads after that, explicit async writes). Same IIFE-wrapped-single-global
// pattern as shared/logger.js/shared/companion-config.js/shared/theme.js/
// i18n/i18n.js (see their own doc comments) — popup.html loads this as a
// classic <script> alongside those.
//
// Unlike theme.js/i18n.js (one scalar preference each) or companion-config.js
// (one string, present or absent), this holds several related preferences
// that are always read/written together — the four toggles that used to be
// per-scrape opt-ins (Output as JSON, trial-run data preview, full output-
// file download, editable XML config) plus the default-script-name
// preference — so it's one chrome.storage.local key holding one object,
// rather than one key per value.
const SFGlobalSettings = (function () {
  const STORAGE_KEY = 'globalSettings';

  // scriptNameMode: 'fixed' (scriptNameFixed is the pre-filled default for
  // every new site) | 'hostname' (the current site's own hostname is derived
  // and pre-filled instead, re-applied every time a new site is detected —
  // see companion-client.js's checkCompanion/message-router.js's stale-URL
  // correction).
  const DEFAULTS = {
    outputAsJson: false,
    includeDataPreview: false,
    includeOutputFile: false,
    externalConfig: false,
    scriptNameMode: 'fixed',
    scriptNameFixed: 'scraper',
  };

  let cached = { ...DEFAULTS };

  async function loadGlobalSettings() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      cached = { ...DEFAULTS };
      return cached;
    }
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      cached = { ...DEFAULTS, ...(stored[STORAGE_KEY] || {}) };
    } catch {
      cached = { ...DEFAULTS };
    }
    return cached;
  }

  // Mirrors theme.js's getTheme()/i18n.js's getLanguage() — synchronous, no
  // storage round trip, so a hot read path (every field.js's render()/every
  // /generate call) doesn't need to be async just to read a preference.
  function getGlobalSettings() {
    return cached;
  }

  async function updateGlobalSettings(patch) {
    cached = { ...cached, ...patch };
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return cached;
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: cached });
    } catch {
      // Best-effort — a failed write just means the change won't survive a restart.
    }
    return cached;
  }

  return { DEFAULTS, loadGlobalSettings, getGlobalSettings, updateGlobalSettings };
})();

if (typeof module !== 'undefined') module.exports = SFGlobalSettings;
if (typeof self !== 'undefined') self.SFGlobalSettings = SFGlobalSettings;
