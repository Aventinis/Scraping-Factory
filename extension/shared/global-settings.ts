// Cross-session user preferences, reached from the popup's own dedicated
// Settings tab (extension/popup/global-settings-ui.ts) — mirrors
// shared/theme.ts's exact pattern (chrome.storage.local, a long-lived device
// preference that should survive a browser restart, not just a popup close/
// reopen; one module-level cache populated once by an async init, synchronous
// reads after that, explicit async writes).
//
// Unlike theme.ts/i18n.js (one scalar preference each) or companion-config.ts
// (one string, present or absent), this holds several related preferences
// that are always read/written together — the four toggles that used to be
// per-scrape opt-ins (Output as JSON, trial-run data preview, full output-
// file download, editable XML config) plus the default-script-name and
// default-output-file-name preferences — so it's one chrome.storage.local key holding one object,
// rather than one key per value.
const STORAGE_KEY = 'globalSettings';

export interface GlobalSettingsValues {
  outputFormat: 'default' | 'json' | 'sqlite' | 'xlsx';
  includeDataPreview: boolean;
  includeOutputFile: boolean;
  externalConfig: boolean;
  skipVerification: boolean;
  scriptNameMode: 'fixed' | 'hostname';
  scriptNameFixed: string;
  outputNameMode: 'fixed' | 'script';
  outputNameFixed: string;
}

// What may be stored: the current shape, plus the boolean the pre-#229 versions wrote.
type StoredSettings = Partial<GlobalSettingsValues> & { outputAsJson?: boolean };

// scriptNameMode: 'fixed' (scriptNameFixed is the pre-filled default for
// every new site) | 'hostname' (the current site's own hostname is derived
// and pre-filled instead, re-applied every time a new site is detected —
// see companion-client.ts's checkCompanion/message-router.ts's stale-URL
// correction).
export const DEFAULTS: GlobalSettingsValues = {
  // Issue #229: 'default' (CSV, or XML for a tree) | 'json' | 'sqlite' | 'xlsx'.
  // Replaces the earlier boolean `outputAsJson` (migrated on load).
  outputFormat: 'default',
  includeDataPreview: false,
  includeOutputFile: false,
  externalConfig: false,
  // Issue #292: skip /generate's trial run — see ScrapingConfig.SkipVerification.
  skipVerification: false,
  scriptNameMode: 'fixed',
  scriptNameFixed: 'scraper',
  // Issue #509: the output file name used when the per-scrape field is empty. 'fixed' with an empty name is today's `output`;
  // 'script' follows the (effective) script name.
  outputNameMode: 'fixed',
  outputNameFixed: '',
};

let cached: GlobalSettingsValues = { ...DEFAULTS };

export async function loadGlobalSettings(): Promise<GlobalSettingsValues> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    cached = { ...DEFAULTS };
    return cached;
  }
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const saved: StoredSettings = stored[STORAGE_KEY] || {};
    const merged: StoredSettings = { ...DEFAULTS, ...saved };
    // Migrate the pre-#229 boolean "Output as JSON" preference.
    if (saved.outputFormat === undefined && saved.outputAsJson === true) merged.outputFormat = 'json';
    delete merged.outputAsJson;
    cached = merged as GlobalSettingsValues;
  } catch {
    cached = { ...DEFAULTS };
  }
  return cached;
}

// Mirrors theme.ts's getTheme()/i18n.js's getLanguage() — synchronous, no
// storage round trip, so a hot read path (every field.js's render()/every
// /generate call) doesn't need to be async just to read a preference.
export function getGlobalSettings(): GlobalSettingsValues {
  return cached;
}

export async function updateGlobalSettings(patch: Partial<GlobalSettingsValues>): Promise<GlobalSettingsValues> {
  cached = { ...cached, ...patch };
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return cached;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: cached });
  } catch {
    // Best-effort — a failed write just means the change won't survive a restart.
  }
  return cached;
}

