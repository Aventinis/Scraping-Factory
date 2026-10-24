// API mode's DOM rendering and event handling. This file is the orchestrator: the API_CONFIG screen's render / confirm / cancel, the
// modals' render, and wireApiConfigEvents, which calls the focused modules in turn. It re-exports every name it used to export, so
// popup.js and idle-screen-ui.js import unchanged:
//   api-capture-ui.ts            recording, searches, candidate / recorded-request lists
//   api-response-tree-ui.ts      response tree, group + transforms modals, tree search
//   api-parameters-ui.ts         URL parts and parameter sources
//   api-browser-discovery-ui.ts  the BrowserDiscoverySource editor
//   api-request-ui.ts            captured headers, POST body tree
//   api-config-shared-ui.ts      draft helpers the modules above share
//
// Handlers that read or mutate popup state take a `bridge` as first parameter — { getState, setState, patchState,
// stopPreviewIfActive, requestDomTree, showToast } — built once by popup.js. It is not just style: popup.js loads after this file and,
// under Jest, each file is an isolated module with no shared scope, so a closure over popup.js's state would not resolve. Purely
// presentational render / build*El functions need none of this.
import type * as SFWire from '../types/wire';
import type { PopupBridge, State } from '../types/popup';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import {
  STATES, buildStaticListSource, buildRangeSource, buildBrowserDiscoverySource, buildApiConfig, allParameterParts, apiConfigDraftHasAllSourcesChosen,
} from './api-config';
import type { ApiConfigDraft, ApiNodeDraft } from './api-config';
import { BOOTSTRAP_SOURCE_KIND, resolveBootstrapUrlParts } from './api-bootstrap';
import { renderTransformList, renderTransformPreview } from './field-transforms-ui';
import { serializeBrowserActions } from './scraping-config-builder';
import { renderGroupPathPicker } from './json-path-picker-ui';
import { patchApiConfigSource } from './api-config-shared-ui';
import {
  buildApiTreeNodeEl,
  renderApiTree,
  startApiTreeFieldSearch,
  confirmApiTreeFieldCandidate,
  openApiGroupModal,
  confirmApiGroupModal,
  cancelApiGroupModal,
  setApiTreeNodeName,
  openApiFieldTransformsModal,
  confirmApiFieldTransformsModal,
  cancelApiFieldTransformsModal,
  wireApiResponseTreeEvents,
} from './api-response-tree-ui';
import {
  renderApiCandidates,
  renderApiEntriesList,
  startApiCapture,
  stopApiCapture,
  toggleApiCapture,
  startApiFieldSearch,
  confirmApiFieldCandidate,
  loadInitialBodyTreeForCandidate,
  startEmbeddedJsonFieldSearch,
  confirmEmbeddedJsonFieldCandidate,
  fetchApiCaptureEntries,
  toggleApiEntriesPanel,
  wireApiCandidateListEvents,
  wireApiCaptureEvents,
} from './api-capture-ui';
import {
  renderBrowserDiscoverySourceFields,
  addDiscoveryAction,
  removeDiscoveryAction,
  updateDiscoveryAction,
} from './api-browser-discovery-ui';
import {
  renderApiConfigUrlParts,
  renderApiConfigParameters,
  renderRangeFormatFields,
  renderDiscoverySourceFields,
  startDiscoverySearch,
  confirmDiscoveryCandidate,
  toggleApiConfigPartVariable,
  setApiConfigPartName,
  setApiConfigSourceKind,
  fillStaticListFromPool,
  wireApiParameterEvents,
} from './api-parameters-ui';
import {
  renderApiConfigHeaders,
  bodyNodeLabel,
  buildBodyTreeNodeEl,
  renderBodyTree,
  setApiConfigHeaderDecision,
  toggleBodyLeafToVariable,
  toggleBodyLeafToFixed,
  setBodyLeafParameter,
  setBodyLeafCoerceTo,
  openBodyParameterModal,
  confirmBodyParameterModal,
  cancelBodyParameterModal,
  wireApiRequestEvents,
} from './api-request-ui';
import { byIdOrNull } from './dom';

const log = createLogger('SF:ApiConfigUI');

// The tree UI subsumes the flat field list: a single match renders as a one-node-deep tree; renderApiTree is the only rendering of this
// part of the screen.
export function renderApiConfigScreen(
  draft: ApiConfigDraft, discoveryCandidates: State['apiDiscoveryCandidates'], discoveryTemplateEditingPartId: string | null | undefined,
): void {
  renderApiTree(draft.groups as ApiNodeDraft[]); // a tree draft: `groups` is always set while the screen is open
  renderApiConfigUrlParts(draft.urlParts);
  renderApiConfigParameters(draft, discoveryCandidates, discoveryTemplateEditingPartId);
  renderApiConfigHeaders(draft.capturedHeaders, draft.headerDecisions, draft.bootstrap);
  renderBodyTree(draft);

  // Issue #136: clarifies why the URL segments above describe a plain page
  // load (with no request/method shown, unlike a network-sourced config)
  // when this ApiConfig was sourced from an embedded <script> tag instead.
  const embeddedJsonNoteEl = byIdOrNull('api-config-embedded-json-note');
  if (embeddedJsonNoteEl) {
    embeddedJsonNoteEl.classList.toggle('hidden', !draft.embeddedJsonSource);
    if (draft.embeddedJsonSource) {
      embeddedJsonNoteEl.textContent = t('apiConfig.embeddedJsonSourceNote', { selector: draft.embeddedJsonSource.scriptSelector });
    }
  }

  // The body section only exists for a POST candidate whose captured
  // request body could actually be turned into a draft (see
  // loadInitialBodyTreeForCandidate) — hidden entirely rather than shown
  // empty for a GET config or an unparsable/bodyless POST.
  const bodySection = byIdOrNull('api-config-body-section');
  if (bodySection) bodySection.classList.toggle('hidden', !draft.bodyTree);

  const confirmBtn = byIdOrNull<HTMLButtonElement>('btn-api-config-confirm');
  if (confirmBtn) confirmBtn.disabled = !apiConfigDraftHasAllSourcesChosen(draft);
}

export function cancelApiConfig(bridge: PopupBridge): void {
  log('API_CONFIG cancel');
  bridge.setState(STATES.IDLE, { apiConfigDraft: null, apiDiscoveryCandidates: null, apiTreeSearchResult: null, apiPathPicker: null });
}

// ── API tree wiring ──
// Adding to a confirmed tree: a new root group (treeParentPath null) or a sub-field under an ApiGroup starts a click-based JSON search
// like startApiFieldSearch, scoped via resolveApiGroupScopePath for the nested case and unscoped for a new root (a second unrelated
// top-level array in the same response is as valid a root as the first); the candidate is inserted via insertApiTreeNode. A
// *sub-group* has no single clicked value to derive from, so modal-api-group-new collects name and path directly, no click.

// Final assembly on "Apply": staticList / range sources are raw UI state in apiConfigDraft and built here from whatever is current;
// discovery sources are already wire objects. Iterates allParameterParts (URL + body-only parameters) so a body-only parameter's
// source resolves like a URL one; idToName is what serializeBodyTree needs to turn a variable leaf's draft-only parameterId into the
// declared name.
export function confirmApiConfig(bridge: PopupBridge): void {
  const draft = bridge.getState().apiConfigDraft as ApiConfigDraft; // only reachable from the API_CONFIG screen
  const parameterSources: Record<string, SFWire.ApiParameterSource> = {};
  const idToName: Record<string, string> = {};
  allParameterParts(draft).forEach((part) => {
    const source = draft.parameterSources[part.id];
    // Issue #220: a bootstrap-sourced URL part is a placeholder for the
    // bootstrap value, never a declared parameter (resolveBootstrapUrlParts
    // below names it after the bootstrap instead).
    if (source.kind === BOOTSTRAP_SOURCE_KIND) return;
    parameterSources[part.name] = source.kind === 'staticList'
      ? buildStaticListSource(source.valuesText)
      : source.kind === 'range'
        ? buildRangeSource(source.type, source.from, source.to, source.format)
        : source.kind === 'browserDiscovery'
          ? buildBrowserDiscoverySource(source.discoveryUrl, serializeBrowserActions(source.actions || []))
          : source as SFWire.DiscoverySource; // a discovery source is already complete once the user could press Apply
    idToName[part.id] = part.name;
  });

  const apiConfig = buildApiConfig({
    urlParts: draft.bootstrap
      ? resolveBootstrapUrlParts(draft.urlParts, draft.parameterSources, draft.bootstrap.name.trim())
      : draft.urlParts,
    groups: draft.groups,
    parameterSources,
    capturedHeaders: draft.capturedHeaders,
    headerDecisions: draft.headerDecisions,
    method: draft.method,
    bodyTree: draft.bodyTree,
    bodyParameterNames: (draft.bodyParameters || []).map(p => p.name),
    parameterIdToName: idToName,
    embeddedJsonSource: draft.embeddedJsonSource,
    bootstrap: draft.bootstrap,
    cursorPagination: draft.cursorPagination,
    linkHeaderPagination: draft.linkHeaderPagination,
  });

  log('API_CONFIG confirm', apiConfig);
  bridge.setState(STATES.IDLE, { apiConfig, apiConfigDraft: null, apiDiscoveryCandidates: null, apiTreeSearchResult: null, apiPathPicker: null });
}

// Called from popup.js's render() only while _state.current === STATES.API_CONFIG
// and an apiConfigDraft is in progress — the screen's own tree-search panel
// and its three small modals (add group, add body parameter, edit a leaf
// field's transform chain).
let groupModalWasOpen = false;
export function renderApiConfigModals(bridge: PopupBridge): void {
  const state = bridge.getState();
  renderApiConfigScreen(state.apiConfigDraft as ApiConfigDraft, state.apiDiscoveryCandidates, state.discoveryTemplateEditingPartId);

  const apiTreeSearchPanel = byIdOrNull('api-tree-search-panel');
  if (apiTreeSearchPanel) {
    if (state.apiTreeSearchResult) {
      renderApiCandidates(state.apiTreeSearchResult, { targetEl: 'api-tree-search-target', listEl: 'api-tree-search-list' });
      apiTreeSearchPanel.classList.remove('hidden');
    } else {
      apiTreeSearchPanel.classList.add('hidden');
    }
  }

  // popup.js hides every modal at the start of each render, so "just opened"
  // can't be read off the DOM: remember whether the previous render had it open.
  // The inputs are reset only on the opening render — a later one (e.g. the
  // JSON-path picker finishing loading) must not wipe what was typed meanwhile.
  const groupModalJustOpened = state.apiGroupModalOpen && !groupModalWasOpen;
  groupModalWasOpen = !!state.apiGroupModalOpen;
  if (state.apiGroupModalOpen) {
    byIdOrNull('modal-api-group-new')?.classList.remove('hidden');
    if (groupModalJustOpened) {
      const nameInput = byIdOrNull<HTMLInputElement>('input-api-group-name');
      if (nameInput) { nameInput.value = ''; nameInput.focus(); }
      const pathInput = byIdOrNull<HTMLInputElement>('input-api-group-path');
      if (pathInput) pathInput.value = '';
    }
  }
  renderGroupPathPicker(bridge); // Issue #404

  if (state.bodyParameterModalOpen) {
    byIdOrNull('modal-api-body-parameter-new')?.classList.remove('hidden');
    const nameInput = byIdOrNull<HTMLInputElement>('input-api-body-parameter-name');
    if (nameInput) { nameInput.value = ''; nameInput.focus(); }
  }

  if (state.apiFieldTransformModalOpen) {
    byIdOrNull('modal-api-field-transforms')?.classList.remove('hidden');
    renderTransformList('api-field-transform-list', state.pendingTransforms, () => bridge.getState().pendingRawText);
    // Issue #147: live preview against the node's own sampleValue, threaded
    // through as pendingRawText by openApiFieldTransformsModal — reuses the
    // same renderTransformPreview flat mode's own preview already calls.
    renderTransformPreview('api-field-transform-preview', state.pendingRawText, state.pendingTransforms);
  }
}

export function wireApiConfigEvents(bridge: PopupBridge): void {
  wireApiCaptureEvents(bridge);
  wireApiCandidateListEvents(
    'api-tree-search-list', () => bridge.getState().apiTreeSearchResult?.candidates,
    (candidate, fieldName, siblingNames) => confirmApiTreeFieldCandidate(bridge, candidate, fieldName, siblingNames),
  );
  wireApiResponseTreeEvents(bridge);
  wireApiParameterEvents(bridge);
  wireApiRequestEvents(bridge);

  byIdOrNull('btn-api-config-cancel')?.addEventListener('click', () => {
    log('BTN api-config-cancel');
    cancelApiConfig(bridge);
  });

  byIdOrNull('btn-api-config-confirm')?.addEventListener('click', () => {
    log('BTN api-config-confirm');
    confirmApiConfig(bridge);
  });

  byIdOrNull('btn-api-config-discard')?.addEventListener('click', () => {
    log('BTN api-config-discard');
    bridge.setState(STATES.IDLE, { apiConfig: null });
  });
}

// Everything this module used to export stays reachable from here: popup.js and idle-screen-ui.js import it unchanged
// (pinned by api-config-ui-exports.test.js).
export {
  buildApiTreeNodeEl,
  renderApiTree,
  renderApiCandidates,
  renderApiEntriesList,
  renderApiConfigUrlParts,
  renderApiConfigParameters,
  renderRangeFormatFields,
  renderDiscoverySourceFields,
  renderBrowserDiscoverySourceFields,
  renderApiConfigHeaders,
  bodyNodeLabel,
  buildBodyTreeNodeEl,
  renderBodyTree,
  startApiCapture,
  stopApiCapture,
  toggleApiCapture,
  startApiFieldSearch,
  confirmApiFieldCandidate,
  loadInitialBodyTreeForCandidate,
  startEmbeddedJsonFieldSearch,
  confirmEmbeddedJsonFieldCandidate,
  startApiTreeFieldSearch,
  confirmApiTreeFieldCandidate,
  openApiGroupModal,
  confirmApiGroupModal,
  cancelApiGroupModal,
  setApiTreeNodeName,
  openApiFieldTransformsModal,
  confirmApiFieldTransformsModal,
  cancelApiFieldTransformsModal,
  startDiscoverySearch,
  confirmDiscoveryCandidate,
  toggleApiConfigPartVariable,
  setApiConfigPartName,
  setApiConfigSourceKind,
  patchApiConfigSource,
  setApiConfigHeaderDecision,
  addDiscoveryAction,
  removeDiscoveryAction,
  updateDiscoveryAction,
  toggleBodyLeafToVariable,
  toggleBodyLeafToFixed,
  setBodyLeafParameter,
  setBodyLeafCoerceTo,
  openBodyParameterModal,
  confirmBodyParameterModal,
  cancelBodyParameterModal,
  fetchApiCaptureEntries,
  toggleApiEntriesPanel,
  fillStaticListFromPool,
};
