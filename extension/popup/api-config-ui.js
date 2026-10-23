// API mode's DOM rendering and event handling. This file is the orchestrator: the API_CONFIG screen's render / confirm / cancel, the
// modals' render, and wireApiConfigEvents, which calls the focused modules in turn. It re-exports every name it used to export, so
// popup.js and idle-screen-ui.js import unchanged:
//   api-capture-ui.js            recording, searches, candidate / recorded-request lists
//   api-response-tree-ui.js      response tree, group + transforms modals, tree search
//   api-parameters-ui.js         URL parts and parameter sources
//   api-browser-discovery-ui.js  the BrowserDiscoverySource editor
//   api-request-ui.js            captured headers, POST body tree
//   api-config-shared-ui.js      draft helpers the modules above share
//
// Handlers that read or mutate popup state take a `bridge` as first parameter — { getState, setState, patchState,
// stopPreviewIfActive, requestDomTree, showToast } — built once by popup.js. It is not just style: popup.js loads after this file and,
// under Jest, each file is an isolated module with no shared scope, so a closure over popup.js's state would not resolve. Purely
// presentational render / build*El functions need none of this.
const { createLogger } = require('../shared/logger');
const log = createLogger('SF:ApiConfigUI');
const { t } = require('../i18n/i18n');
const {
  STATES, buildStaticListSource, buildRangeSource, buildBrowserDiscoverySource, buildApiConfig, allParameterParts, apiConfigDraftHasAllSourcesChosen,
} = require('./api-config');
const { BOOTSTRAP_SOURCE_KIND, resolveBootstrapUrlParts } = require('./api-bootstrap');
const { renderTransformList, renderTransformPreview } = require('./field-transforms-ui');
const { serializeBrowserActions } = require('./scraping-config-builder');
const { renderGroupPathPicker } = require('./json-path-picker-ui');
const {
  patchApiConfigSource,
} = require('./api-config-shared-ui');
const {
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
} = require('./api-response-tree-ui');
const {
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
} = require('./api-capture-ui');
const {
  renderBrowserDiscoverySourceFields,
  addDiscoveryAction,
  removeDiscoveryAction,
  updateDiscoveryAction,
} = require('./api-browser-discovery-ui');
const {
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
} = require('./api-parameters-ui');
const {
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
} = require('./api-request-ui');

// The tree UI subsumes the flat field list: a single match renders as a one-node-deep tree; renderApiTree is the only rendering of this
// part of the screen.
function renderApiConfigScreen(draft, discoveryCandidates, discoveryTemplateEditingPartId) {
  renderApiTree(draft.groups);
  renderApiConfigUrlParts(draft.urlParts);
  renderApiConfigParameters(draft, discoveryCandidates, discoveryTemplateEditingPartId);
  renderApiConfigHeaders(draft.capturedHeaders, draft.headerDecisions, draft.bootstrap);
  renderBodyTree(draft);

  // Issue #136: clarifies why the URL segments above describe a plain page
  // load (with no request/method shown, unlike a network-sourced config)
  // when this ApiConfig was sourced from an embedded <script> tag instead.
  const embeddedJsonNoteEl = document.getElementById('api-config-embedded-json-note');
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
  const bodySection = document.getElementById('api-config-body-section');
  if (bodySection) bodySection.classList.toggle('hidden', !draft.bodyTree);

  const confirmBtn = document.getElementById('btn-api-config-confirm');
  if (confirmBtn) confirmBtn.disabled = !apiConfigDraftHasAllSourcesChosen(draft);
}

function cancelApiConfig(bridge) {
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
function confirmApiConfig(bridge) {
  const draft = bridge.getState().apiConfigDraft;
  const parameterSources = {};
  const idToName = {};
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
          : source;
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
function renderApiConfigModals(bridge) {
  const state = bridge.getState();
  renderApiConfigScreen(state.apiConfigDraft, state.apiDiscoveryCandidates, state.discoveryTemplateEditingPartId);

  const apiTreeSearchPanel = document.getElementById('api-tree-search-panel');
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
    document.getElementById('modal-api-group-new')?.classList.remove('hidden');
    if (groupModalJustOpened) {
      const nameInput = document.getElementById('input-api-group-name');
      if (nameInput) { nameInput.value = ''; nameInput.focus(); }
      const pathInput = document.getElementById('input-api-group-path');
      if (pathInput) pathInput.value = '';
    }
  }
  renderGroupPathPicker(bridge); // Issue #404

  if (state.bodyParameterModalOpen) {
    document.getElementById('modal-api-body-parameter-new')?.classList.remove('hidden');
    const nameInput = document.getElementById('input-api-body-parameter-name');
    if (nameInput) { nameInput.value = ''; nameInput.focus(); }
  }

  if (state.apiFieldTransformModalOpen) {
    document.getElementById('modal-api-field-transforms')?.classList.remove('hidden');
    renderTransformList('api-field-transform-list', state.pendingTransforms, () => bridge.getState().pendingRawText);
    // Issue #147: live preview against the node's own sampleValue, threaded
    // through as pendingRawText by openApiFieldTransformsModal — reuses the
    // same renderTransformPreview flat mode's own preview already calls.
    renderTransformPreview('api-field-transform-preview', state.pendingRawText, state.pendingTransforms);
  }
}

function wireApiConfigEvents(bridge) {
  wireApiCaptureEvents(bridge);
  wireApiCandidateListEvents(
    'api-tree-search-list', () => bridge.getState().apiTreeSearchResult?.candidates,
    (candidate, fieldName, siblingNames) => confirmApiTreeFieldCandidate(bridge, candidate, fieldName, siblingNames),
  );
  wireApiResponseTreeEvents(bridge);
  wireApiParameterEvents(bridge);
  wireApiRequestEvents(bridge);

  document.getElementById('btn-api-config-cancel')?.addEventListener('click', () => {
    log('BTN api-config-cancel');
    cancelApiConfig(bridge);
  });

  document.getElementById('btn-api-config-confirm')?.addEventListener('click', () => {
    log('BTN api-config-confirm');
    confirmApiConfig(bridge);
  });

  document.getElementById('btn-api-config-discard')?.addEventListener('click', () => {
    log('BTN api-config-discard');
    bridge.setState(STATES.IDLE, { apiConfig: null });
  });
}

module.exports = {
  buildApiTreeNodeEl,
  renderApiTree,
  renderApiCandidates,
  renderApiEntriesList,
  renderApiConfigScreen,
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
  cancelApiConfig,
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
  confirmApiConfig,
  fetchApiCaptureEntries,
  toggleApiEntriesPanel,
  fillStaticListFromPool,
  renderApiConfigModals,
  wireApiConfigEvents,
};
