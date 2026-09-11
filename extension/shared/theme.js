// Resolves the popup's light/dark theme and persists an explicit manual
// override (Issue #140), mirroring i18n.js's getStoredLanguage/setLanguage
// pattern exactly (chrome.storage.local — a long-lived device preference
// that should survive a browser restart, not just a popup close/reopen).
// Same IIFE-wrapped-single-global pattern as shared/logger.js/
// shared/companion-config.js/i18n/i18n.js (see their own doc comments) —
// popup.html loads this as a classic <script> alongside those.
//
// Unlike the language preference (always one of three explicit values), a
// theme has a third, unstored state: "follow the OS" (no override at all).
// That's represented as `null` throughout this module rather than a
// `'system'` string, so a caller can't accidentally persist the literal
// word "system" as if it were a real theme value — null intentionally
// can't round-trip through chrome.storage.local's key/value shape the way
// a string could, an explicit "no stored preference" instead of a
// storable-but-meaningless one.
const SFTheme = (function () {
  const THEMES = ['light', 'dark'];
  const STORAGE_KEY = 'theme';

  async function getStoredTheme() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      return THEMES.includes(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : null;
    } catch {
      return null;
    }
  }

  async function persistTheme(theme) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    try {
      if (theme === null) await chrome.storage.local.remove(STORAGE_KEY);
      else await chrome.storage.local.set({ [STORAGE_KEY]: theme });
    } catch {
      // Best-effort — a failed write just means the choice won't survive a restart.
    }
  }

  // Sets/removes the data-theme attribute popup.html's CSS keys off:
  // :root:not([data-theme]) picks up @media (prefers-color-scheme: dark)
  // automatically when the attribute is absent (theme === null, "follow
  // system"); :root[data-theme="light"|"dark"] overrides that when present.
  function applyTheme(theme) {
    if (typeof document === 'undefined' || !document.documentElement) return;
    if (theme === null) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }

  // Mirrors i18n.js's currentLanguage/getLanguage() pair — the popup needs
  // synchronous access to "what's the theme right now" to render the toggle
  // button's icon/title and to know what cycleTheme() should advance from,
  // without every caller re-awaiting a storage round trip.
  let currentTheme = null;

  async function initTheme() {
    currentTheme = await getStoredTheme();
    applyTheme(currentTheme);
    return currentTheme;
  }

  function getTheme() {
    return currentTheme;
  }

  // system (null) -> light -> dark -> system — a single compact toggle
  // button cycles through all three instead of a dropdown, which wouldn't
  // fit next to the existing language selector at this panel width (see
  // #theme-toggle in popup.html).
  function nextTheme(current) {
    if (current === null) return 'light';
    if (current === 'light') return 'dark';
    return null;
  }

  async function cycleTheme() {
    const next = nextTheme(currentTheme);
    applyTheme(next);
    await persistTheme(next);
    currentTheme = next;
    return next;
  }

  return { THEMES, getStoredTheme, applyTheme, initTheme, getTheme, nextTheme, cycleTheme };
})();

if (typeof module !== 'undefined') module.exports = SFTheme;
if (typeof self !== 'undefined') self.SFTheme = SFTheme;
