// The guidance on the "Companion app unreachable" screen: pure logic plus the one persisted flag (companion-guidance-ui.js renders it). Until the first
// successful health check the screen explains in full what the companion is and the three situations with their next step; afterwards the short form.
// Wording lives in i18n/*.json (`error.*`, `help.companionError.*`), so it works offline.
export const STORAGE_KEY = 'companionReached';

export type Platform = 'windows' | 'mac' | 'linux';
export type Situation = 'install' | 'start' | 'address';

/** The operating system the installer to point at belongs to. Anything that isn't Windows or macOS gets the Linux/shell instructions. */
export function detectPlatform(userAgent: string | undefined | null): Platform {
  const ua = String(userAgent || '');
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
  return 'linux';
}

export function installerName(platform: Platform): string {
  return platform === 'windows' ? 'install.ps1' : 'install.sh';
}

// What to type in the folder of the unpacked download — exactly the command
// install/INSTALL.md gives, with autostart so the companion comes back after
// every login.
export function installCommand(platform: Platform): string {
  return platform === 'windows'
    ? 'powershell -ExecutionPolicy Bypass -File .\\install.ps1 -Autostart'
    : './install.sh --autostart';
}

// Where the installers put the companion program (install.sh / install.ps1:
// <data directory>/app/companion/…).
export function installedProgramPath(platform: Platform): string {
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
 */
export function likelySituations(
  { url, defaultUrl, errorMessage }: { url: string | null; defaultUrl: string; errorMessage?: string | null },
): Situation[] {
  if (/^HTTP \d{3}/.test(String(errorMessage || ''))) return ['address'];
  if (url && url !== defaultUrl) return ['address'];
  return ['install', 'start'];
}

// ── The "has a companion ever answered here" flag ──
// chrome.storage.local like the language / theme: a device fact that survives restarts. Cached so render can read it synchronously.
let reached = false;

export function isCompanionReached(): boolean {
  return reached;
}

export async function loadCompanionReached(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return reached;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    reached = stored[STORAGE_KEY] === true;
  } catch {
    // Unreadable storage just means the long explanation is shown again.
  }
  return reached;
}

export async function markCompanionReached(): Promise<void> {
  if (reached) return;
  reached = true;
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: true });
  } catch {
    // Best-effort, same as the other device preferences.
  }
}
