// Issue #406: the guidance shown on the "Companion app unreachable" screen —
// pure logic (this file) plus the one persisted flag it needs; the rendering
// is in companion-guidance-ui.js. A user who has never had a companion
// answer doesn't know what it is or where it comes from, so until the first
// successful health check the screen explains it in full (what it is, and the
// three situations with the concrete next step for each); afterwards it shows
// the short form. Everything here is text-free — wording lives in
// i18n/*.json (`error.*`, `help.companionError.*`) so it works offline.
const STORAGE_KEY = 'companionReached';

/** @typedef {'windows' | 'mac' | 'linux'} Platform */

/**
 * The operating system the installer to point at belongs to. Anything that
 * isn't Windows or macOS gets the Linux/shell instructions.
 * @param {string | undefined | null} userAgent
 * @returns {Platform}
 */
function detectPlatform(userAgent) {
  const ua = String(userAgent || '');
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
  return 'linux';
}

/** @param {Platform} platform */
function installerName(platform) {
  return platform === 'windows' ? 'install.ps1' : 'install.sh';
}

// What to type in the folder of the unpacked download — exactly the command
// install/INSTALL.md gives, with autostart so the companion comes back after
// every login.
/** @param {Platform} platform */
function installCommand(platform) {
  return platform === 'windows'
    ? 'powershell -ExecutionPolicy Bypass -File .\\install.ps1 -Autostart'
    : './install.sh --autostart';
}

// Where the installers put the companion program (install.sh / install.ps1:
// <data directory>/app/companion/…).
/** @param {Platform} platform */
function installedProgramPath(platform) {
  if (platform === 'windows') return '%APPDATA%\\ScrapingFactory\\app\\companion\\ScrapingFactory.Companion.exe';
  if (platform === 'mac') return '~/Library/Application Support/ScrapingFactory/app/companion/ScrapingFactory.Companion';
  return '~/.config/ScrapingFactory/app/companion/ScrapingFactory.Companion';
}

/**
 * Which of the three situations is the most likely cause, from what the failed
 * health check can tell: something that answers with an HTTP error is not a
 * healthy companion (wrong port or program), and a custom address is the first
 * thing to doubt; only the default address that doesn't answer at all points at
 * "not installed" / "not running".
 * @param {{ url: string | null, defaultUrl: string, errorMessage?: string | null }} failure
 * @returns {Array<'install' | 'start' | 'address'>}
 */
function likelySituations({ url, defaultUrl, errorMessage }) {
  if (/^HTTP \d{3}/.test(String(errorMessage || ''))) return ['address'];
  if (url && url !== defaultUrl) return ['address'];
  return ['install', 'start'];
}

// ── The "has a companion ever answered here" flag ───────────────────────────
// chrome.storage.local, like the language/theme preferences: a device fact that
// should survive closing the panel and restarting the browser. Cached so the
// render can read it synchronously.
let reached = false;

function isCompanionReached() {
  return reached;
}

async function loadCompanionReached() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return reached;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    reached = stored[STORAGE_KEY] === true;
  } catch {
    // Unreadable storage just means the long explanation is shown again.
  }
  return reached;
}

async function markCompanionReached() {
  if (reached) return;
  reached = true;
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: true });
  } catch {
    // Best-effort, same as the other device preferences.
  }
}

module.exports = {
  STORAGE_KEY, detectPlatform, installerName, installCommand, installedProgramPath, likelySituations,
  isCompanionReached, loadCompanionReached, markCompanionReached,
};
