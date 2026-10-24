// ── Download helpers ─────────────────────────────────────────────────────────
// Extracted from popup.js (docs/design-notes/extension.md, "Popup module boundaries") — every "save this Blob to disk via a throwaway
// anchor click" action lives here. Functions that need the current
// configuration take a `bridge` object (same convention as
// api-config-ui.js/companion-client.js) instead of closing over popup.js's
// own module-level state; downloadFile itself is state-free.
import type * as SFDraft from '../types/drafts';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import { sanitizeFileNameBase, buildConfigExport, configOptionsFromState } from './scraping-config-builder';
import type { ConfigState } from './scraping-config-builder';
import type { CombinedComponentRef } from './combined-config';
import { resolveCombinedComponents } from './companion-client';
import { showToast } from './toast';
import { getGlobalSettings } from '../shared/global-settings';

const log = createLogger('SF:Popup');

export interface DownloadState extends ConfigState {
  scriptText: string;
  outputFile: { fileName: string; content: string } | null;
  combinedComponents: CombinedComponentRef[];
}

export interface DownloadBridge {
  getState(): DownloadState;
}

export function triggerDownload(bridge: DownloadBridge): void {
  const state = bridge.getState();
  const fileName = `${sanitizeFileNameBase(state.scriptFileName, 'scraper')}.py`;
  log('DOWNLOAD', fileName);
  const blob = new Blob([state.scriptText], { type: 'text/plain' });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

// Issue #161: downloads the companion's actual, complete trial-run output
// (_state.outputFile, set by generate() when includeOutputFile was on) —
// the full dataset, not the capped preview sample. MIME type is picked from
// the file's own extension purely for a nicer browser "open with" hint;
// the `download` attribute forces a save regardless.
const OUTPUT_FILE_MIME_TYPES: Record<string, string> = {
  csv: 'text/csv', xml: 'application/xml', json: 'application/json',
  sqlite: 'application/vnd.sqlite3',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
// Issue #229: the binary table formats travel as base64 text (in the
// /generate response and in a saved output's stored content alike); the file
// extension tells which content needs decoding back into bytes.
const BINARY_OUTPUT_EXTENSIONS: string[] = ['sqlite', 'xlsx'];

// Extracted so Issue #202's "download a saved output" action (a fetched
// SavedOutputRecord, not _state.outputFile) can reuse the exact same
// MIME-guessing/anchor-click mechanics.
export function downloadFile(fileName: string, content: string): void {
  log('DOWNLOAD_OUTPUT', fileName);
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  const part = BINARY_OUTPUT_EXTENSIONS.includes(extension)
    ? Uint8Array.from(atob(content), (c) => c.charCodeAt(0))
    : content;
  const blob = new Blob([part], { type: OUTPUT_FILE_MIME_TYPES[extension] || 'text/plain' });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

export function triggerOutputFileDownload(bridge: DownloadBridge): void {
  const state = bridge.getState();
  if (!state.outputFile) return;
  downloadFile(state.outputFile.fileName, state.outputFile.content);
}

// Lets a user hand over the current Fields/Groups configuration when
// reporting a selector problem, without having to describe their setup by
// hand — e.g. attached to a "Report bug" GitHub issue or shared directly.
// Async since Combined mode (Issue #239) needs to resolve each component's
// full config live (GET /configs/{id}) before it can be exported — every
// other mode resolves synchronously and awaits nothing extra.
export async function downloadConfigExport(bridge: DownloadBridge): Promise<void> {
  const state = bridge.getState();
  const manifest: { version?: string } = typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest() : {};

  let combinedComponents: SFDraft.CombinedComponent[] | null = null;
  if (state.mode === 'combined') {
    try {
      combinedComponents = await resolveCombinedComponents(state.combinedComponents || []);
    } catch (err) {
      log('DOWNLOAD scraping-config.json COMBINED RESOLVE FAIL', (err as Error).message);
      showToast(t('toast.generationError', { message: (err as Error).message }), 'Export configuration');
      return;
    }
  }

  // Issue-driven follow-up: outputAsJson/includeDataPreview/externalConfig
  // moved from per-scrape _state to the cross-session global Settings tab
  // (shared/global-settings.ts) — read from there now, same as generate().
  const globalSettings = getGlobalSettings();
  const exportObj = buildConfigExport(
    configOptionsFromState(state, globalSettings, { manifest, combinedComponents, includeOutputFile: false }));
  log('DOWNLOAD scraping-config.json', exportObj);

  const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `scraping-config-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}
