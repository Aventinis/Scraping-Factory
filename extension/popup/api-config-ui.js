// API mode's own DOM rendering and event-handling logic (Issue #53/#54/#55):
// the response/body tree editors, the candidate-search result lists, the
// full API_CONFIG screen, and every handler that mutates apiConfigDraft or
// starts/stops network recording and click-based searches. Split out of
// popup.js (which had grown past 3800 lines) purely for readability — no
// behavior change.
//
// Issue #390: this file is now the orchestrator — the API_CONFIG screen's own
// render/confirm/cancel, the modals' render, and wireApiConfigEvents, which
// calls the focused modules below in turn — and re-exports every name it
// used to export, so popup.js and idle-screen-ui.js import unchanged:
//   api-capture-ui.js          recording, searches, candidate/recorded-request lists
//   api-response-tree-ui.js    response tree, group + transforms modals, tree search
//   api-parameters-ui.js       URL parts and parameter sources
//   api-browser-discovery-ui.js  the BrowserDiscoverySource editor
//   api-request-ui.js          captured headers, POST body tree
//   api-config-shared-ui.js    draft helpers the modules above share
//
// Unlike api-config.js's pure builder/validator functions, most of the
// event-handler functions here (anything that reads or mutates popup state)
// take a `bridge` object as their first parameter — `{ getState, setState,
// patchState, stopPreviewIfActive, requestDomTree, showToast }` — built once
// by popup.js's wireEvents() and passed through on every call, instead of
// closing over popup.js's own `_state`/`setState`/etc. the way these
// functions did before the split. This isn't just style: popup.js loads
// *after* this file (see popup.html), so a plain closure over popup.js's
// module-level state wouldn't exist yet when this file's own top-level code
// runs, and — more importantly — would silently fail to resolve at all
// under Jest, where each file is a separate, isolated `require()`d module
// with no shared global scope. Passing `bridge` explicitly works identically
// in both environments. Purely presentational functions (the render/build*El
// functions below) need none of this — they already took explicit arguments
// before the split and still do.
const { createLogger } = require('../shared/logger');
const log = createLogger('SF:ApiConfigUI');
const { t } = require('../i18n/i18n');
const {
  STATES, buildStaticListSource, buildRangeSource, buildBrowserDiscoverySource, buildApiConfig, allParameterParts, apiConfigDraftHasAllSourcesChosen,
} = require('./api-config');
const { BOOTSTRAP_SOURCE_KIND, resolveBootstrapUrlParts } = require('./api-bootstrap');
const { renderTransformList, renderTransformPreview } = require('./field-transforms-ui');
const { serializeBrowserActions } = require('./scraping-config-builder');
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

// Issue #54, Phase A5: the tree UI subsumes the flat field list entirely —
// a single top-level match renders as a one-node-deep tree, visually almost
// identical to the old flat list but wrapped in the same tree-editor chrome
// every level beyond that reuses unchanged. renderApiConfigFieldsList is
// gone; renderApiTree (Phase A4) is the only rendering left for this part
// of the screen.
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
  bridge.setState(STATES.IDLE, { apiConfigDraft: null, apiDiscoveryCandidates: null, apiTreeSearchResult: null });
}

// ── API-Mode tree wiring (Issue #54, Phase A5) ──────────────────────────────
// Adding to an already-confirmed tree: a new independent root group
// (treeParentPath null) or a sub-field under an existing ApiGroup
// (treeParentPath its tree path) both start a click-based JSON search the
// same way startApiFieldSearch does above — scoped via resolveApiGroupScopePath
// for the nested case, unscoped for a new root (Groups is a list; a second,
// unrelated top-level array in the *same* response body is exactly as valid
// a root as the first, see ApiConfig.Groups's own doc comment) — and the
// confirmed candidate is inserted via insertApiTreeNode rather than
// replacing the draft outright.
//
// A *sub-group* is different: unlike a field/root search, there's no single
// clicked value to derive it from that wouldn't also imply a field the user
// never asked for — so modal-api-group-new collects name **and** path
// directly (no click at all), mirroring Container-Mode's "name first" order
// while side-stepping the "what would the click's own leaf field be called"
// question entirely. See openApiGroupModal/confirmApiGroupModal below.

// Final assembly (Issue #53 Phase 5's "Apply"): staticList/range
// sources are only ever kept as raw UI state (valuesText / type+from+to) in
// apiConfigDraft, never as a built wire object — built here, once, from
// whatever's currently in state. discovery sources are already complete
// wire objects (built earlier by confirmDiscoveryCandidate) and passed
// through as-is.
//
// Issue #55, Phase B4: iterates allParameterParts (URL + body-only) instead
// of just variableUrlParts, so a body-only parameter's source is resolved
// into the wire-ready parameterSources map exactly like a URL one already
// was — idToName is then the one piece serializeBodyTree needs to turn a
// variable leaf's draft-only parameterId into the actual declared name.
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
  bridge.setState(STATES.IDLE, { apiConfig, apiConfigDraft: null, apiDiscoveryCandidates: null, apiTreeSearchResult: null });
}

// Called from popup.js's render() only while _state.current === STATES.API_CONFIG
// and an apiConfigDraft is in progress — the screen's own tree-search panel
// and its three small modals (add group, add body parameter, edit a leaf
// field's transform chain).
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

  if (state.apiGroupModalOpen) {
    document.getElementById('modal-api-group-new')?.classList.remove('hidden');
    const nameInput = document.getElementById('input-api-group-name');
    if (nameInput) { nameInput.value = ''; nameInput.focus(); }
    const pathInput = document.getElementById('input-api-group-path');
    if (pathInput) pathInput.value = '';
  }

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
