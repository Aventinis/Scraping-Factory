// ── Preview mode ─────────────────────────────────────────────────────────────
// Extracted from popup.js (see CLAUDE.md's "Popup module boundaries"
// architecture decision). Sends the current Fields/Groups to the content
// script so it can match them against the live DOM and highlight the
// results directly on the page — see content-script.js's
// computePreviewMatches/startPreview for the matching semantics (mirrors
// the backend codegen exactly). Takes a `bridge` object (same convention as
// api-config-ui.js/container-tree-ui.js/dom-tree-ui.js) instead of closing
// over popup.js's own module-level state.
//
// Not to be confused with Issue #122's unrelated trial-run "data preview"
// (dataPreview/renderDataPreview) — this is the pre-existing DOM-highlight
// feature (previewActive/#btn-preview), which highlights matched elements
// on the live page and has nothing to do with the generated script's
// actual trial-run output.
const SFPreview = (function() {
const { createLogger } =
  typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
const log = createLogger('SF:Popup');

const { serializeGroupTree } =
  typeof require !== 'undefined' ? require('./container-tree') : self.SFContainerTree;

function startPreview(bridge) {
  const state = bridge.getState();
  const hasConfig = state.mode === 'container' ? state.groups.length > 0 : state.fields.length > 0;
  if (!hasConfig) return;

  const payload = state.mode === 'container'
    ? { groups: serializeGroupTree(state.groups) }
    : { fields: state.fields.map(f => ({ name: f.name, selector: f.selector })) };
  log('PREVIEW_START', { mode: state.mode, ...payload });
  chrome.runtime.sendMessage({ type: 'PREVIEW_START', mode: state.mode, ...payload });
  bridge.patchState({ previewActive: true, previewSummary: null });
}

function stopPreview(bridge) {
  log('PREVIEW_STOP');
  chrome.runtime.sendMessage({ type: 'PREVIEW_STOP' });
  bridge.patchState({ previewActive: false, previewSummary: null });
}

function togglePreview(bridge) {
  if (bridge.getState().previewActive) stopPreview(bridge); else startPreview(bridge);
}

// Called wherever the Fields/Groups configuration changes or a new selection
// starts — an active preview would otherwise keep showing highlights for a
// configuration that no longer matches the current state.
function stopPreviewIfActive(bridge) {
  if (bridge.getState().previewActive) stopPreview(bridge);
}

  return {startPreview, stopPreview, togglePreview, stopPreviewIfActive};
})();

if (typeof module !== 'undefined') module.exports = SFPreview;
if (typeof self !== 'undefined') self.SFPreview = SFPreview;
