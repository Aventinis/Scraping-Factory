// ── Preview mode ─────────────────────────────────────────────────────────────
// Extracted from popup.ts (docs/design-notes/extension.md, "Popup module boundaries"). Sends the current Fields/Groups to the content
// script so it can match them against the live DOM and highlight the
// results directly on the page — see content-script.ts's
// computePreviewMatches/startPreview for the matching semantics (mirrors
// the backend codegen exactly). Takes a `bridge` object (same convention as
// api-config-ui.ts/container-tree-ui.js/dom-tree-ui.js) instead of closing
// over popup.ts's own module-level state.
//
// Not to be confused with Issue #122's unrelated trial-run "data preview"
// (dataPreview/renderDataPreview) — this is the pre-existing DOM-highlight
// feature (previewActive/#btn-preview), which highlights matched elements
// on the live page and has nothing to do with the generated script's
// actual trial-run output.
import type * as SFDraft from '../types/drafts';
import { createLogger } from '../shared/logger';
import { serializeGroupTree } from './container-tree';

const log = createLogger('SF:Popup');

export interface PreviewState {
  mode: string;
  groups: SFDraft.ContainerNode[];
  fields: SFDraft.Field[];
  previewActive: boolean;
}

export interface PreviewBridge {
  getState(): PreviewState;
  patchState(patch: { previewActive: boolean; previewSummary: null }): void;
}

export function startPreview(bridge: PreviewBridge): void {
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

export function stopPreview(bridge: PreviewBridge): void {
  log('PREVIEW_STOP');
  chrome.runtime.sendMessage({ type: 'PREVIEW_STOP' });
  bridge.patchState({ previewActive: false, previewSummary: null });
}

export function togglePreview(bridge: PreviewBridge): void {
  if (bridge.getState().previewActive) stopPreview(bridge); else startPreview(bridge);
}

// Called wherever the Fields/Groups configuration changes or a new selection
// starts — an active preview would otherwise keep showing highlights for a
// configuration that no longer matches the current state.
export function stopPreviewIfActive(bridge: PreviewBridge): void {
  if (bridge.getState().previewActive) stopPreview(bridge);
}
