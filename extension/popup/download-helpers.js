// ── Download helpers ─────────────────────────────────────────────────────────
// Extracted from popup.js (see CLAUDE.md's "Popup module boundaries"
// architecture decision) — every "save this Blob to disk via a throwaway
// anchor click" action lives here. Functions that need the current
// configuration take a `bridge` object (same convention as
// api-config-ui.js/companion-client.js) instead of closing over popup.js's
// own module-level state; downloadFile itself is state-free.
const SFDownloadHelpers = (function() {
const { createLogger } =
  typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
const log = createLogger('SF:Popup');

const { t } =
  typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;

const { sanitizeFileNameBase, buildConfigExport } =
  typeof require !== 'undefined' ? require('./scraping-config-builder') : self.SFScrapingConfigBuilder;

const { resolveCombinedComponents } =
  typeof require !== 'undefined' ? require('./companion-client') : self.SFCompanionClient;

const { showToast } =
  typeof require !== 'undefined' ? require('./toast') : self.SFToast;

function triggerDownload(bridge) {
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
const OUTPUT_FILE_MIME_TYPES = { csv: 'text/csv', xml: 'application/xml', json: 'application/json' };

// Extracted so Issue #202's "download a saved output" action (a fetched
// SavedOutputRecord, not _state.outputFile) can reuse the exact same
// MIME-guessing/anchor-click mechanics.
function downloadFile(fileName, content) {
  log('DOWNLOAD_OUTPUT', fileName);
  const extension = fileName.split('.').pop()?.toLowerCase();
  const blob = new Blob([content], { type: OUTPUT_FILE_MIME_TYPES[extension] || 'text/plain' });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

function triggerOutputFileDownload(bridge) {
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
async function downloadConfigExport(bridge) {
  const state = bridge.getState();
  const manifest = typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest() : {};

  let combinedComponents = null;
  if (state.mode === 'combined') {
    try {
      combinedComponents = await resolveCombinedComponents(state.combinedComponents || []);
    } catch (err) {
      log('DOWNLOAD scraping-config.json COMBINED RESOLVE FAIL', err.message);
      showToast(t('toast.generationError', { message: err.message }), 'Export configuration');
      return;
    }
  }

  const exportObj = buildConfigExport(
    state.url, state.mode, state.fields, state.groups, manifest, state.apiConfig,
    state.scriptFileName, state.outputFileName, state.engine, state.browserActions, state.includeDataPreview,
    state.useJsonOutput, state.additionalStartUrls, state.changeDetection, state.proxy, state.hardening,
    state.pagination, state.persistentSession, false, state.externalConfig, combinedComponents,
  );
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

  return {triggerDownload, downloadFile, triggerOutputFileDownload, downloadConfigExport};
})();

if (typeof module !== 'undefined') module.exports = SFDownloadHelpers;
if (typeof self !== 'undefined') self.SFDownloadHelpers = SFDownloadHelpers;
