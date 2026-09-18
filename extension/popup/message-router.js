// ── Inbound content-script/service-worker message dispatch ──────────────────
// Extracted from popup.js (see CLAUDE.md's "Popup module boundaries"
// architecture decision) — the single chrome.runtime.onMessage listener that
// handles every message type content-script.js/service-worker.js send back
// to the popup (selection results, DOM tree data, preview/API-capture
// results, ...) was the last large, self-contained chunk of popup.js's
// wireEvents() not yet claimed by any feature module. It's genuinely
// cross-cutting — a single dispatch table touching container/browser-action/
// pagination/DOM-tree/preview/API-capture state alike — so it gets its own
// module rather than joining any one of those feature areas specifically.
// Takes a `bridge` object (same convention as every other extracted module)
// instead of closing over popup.js's own module-level state.
const SFMessageRouter = (function () {
  const { createLogger } = typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
  const log = createLogger('SF:Popup');
  const { t } = typeof require !== 'undefined' ? require('../i18n/i18n') : self.SFI18n;
  const { STATES } = typeof require !== 'undefined' ? require('./api-config') : self.SFApiConfig;
  const { buildGroupNode, insertContainerNode } =
    typeof require !== 'undefined' ? require('./container-tree') : self.SFContainerTree;
  const { updateBrowserAction } =
    typeof require !== 'undefined' ? require('./scraping-config-builder') : self.SFScrapingConfigBuilder;
  const { showToast, showMatchCountToast, setLastError } =
    typeof require !== 'undefined' ? require('./toast') : self.SFToast;
  const { cancelPendingDomTreeRequest, renderDomTree, highlightHover, highlightSelected } =
    typeof require !== 'undefined' ? require('./dom-tree-ui') : self.SFDomTreeUI;

  function wireMessageListener(bridge) {
    chrome.runtime.onMessage.addListener((message) => {
      log('MSG_IN', message);
      const state = bridge.getState();
      if (message.type === 'SELECTION_UNAVAILABLE' && state.current === STATES.SELECTING) {
        log('SELECTION_UNAVAILABLE', message.reason);
        setLastError(message.reason, 'Element selection');
        const returnTo = state.apiConfigDraft ? STATES.API_CONFIG : STATES.IDLE;
        bridge.setState(returnTo, {
          selectionKind: null, pendingParentPath: null, pendingNewContainer: null,
          pendingBrowserActionIndex: null, pendingBrowserActionField: 'selector', apiSearchTarget: null,
        });
        // Issue #137 follow-up: content-script.js's retryScopeSelector tags
        // its own "retried and still nothing" case with unavailableKind —
        // distinct from the other SELECTION_UNAVAILABLE sender (service-
        // worker.js, when chrome.tabs.sendMessage itself fails — no content
        // script running at all). A scope selector legitimately, repeatedly
        // failing to resolve can have entirely page-specific causes outside
        // the extension's control (confirmed via a real report: a class only
        // present while the element is actually hovered, gone the instant the
        // cursor leaves the page for the side panel) — not a plugin
        // malfunction, so it's shown as a softer warning with no "Report bug"
        // button (no context passed to showToast) instead of the harder error
        // styling the other, genuinely unexpected case still gets.
        if (message.unavailableKind === 'scopeSelectorNotFound') {
          showToast(t('toast.scopeSelectorNotFound'), null, 'warn');
        } else {
          showToast(t('toast.selectionUnavailable'), 'Element selection');
        }
      }
      // Issue #167: a click that landed outside every instance of the
      // container being edited — selection stays active (unlike
      // SELECTION_UNAVAILABLE above, which is a hard failure), this is just a
      // brief nudge so the user isn't left guessing why nothing happened.
      if (message.type === 'SELECTION_CLICK_OUT_OF_SCOPE' && state.current === STATES.SELECTING) {
        showToast(t('toast.clickOutsideScope'), null, 'warn');
      }
      if (message.type === 'ELEMENT_SELECTED' && state.current === STATES.SELECTING) {
        log('ELEMENT_SELECTED received (real-time)', message.selector);
        if (state.apiSearchTarget) {
          // API-mode search: content-script.js always sends this too (same
          // click), but the actual result arrives as a separate API_CANDIDATES
          // message right after — handled below, nothing to do with the plain
          // selector here.
          return;
        }
        // Clear the storage entry the service worker wrote — we have it now.
        chrome.storage.session.remove('pendingSelector');
        const framePath = message.framePath || null;
        const matchCount = typeof message.matchCount === 'number' ? message.matchCount : null;
        if (state.mode === 'container' && state.selectionKind === 'container') {
          // Name/type were already collected by modal-container-new — insert
          // the new group node straight away, no further modal needed. There's
          // no modal left open at this point to show the match count in (Issue
          // #85), so it's surfaced as a toast instead — read the name before
          // setState() clears pendingNewContainer.
          const containerName = state.pendingNewContainer.name;
          const node = buildGroupNode(state.pendingNewContainer.name, message.selector, state.pendingNewContainer.repeating, framePath);
          bridge.setState(STATES.IDLE, {
            groups: insertContainerNode(state.groups, state.pendingParentPath, node),
            selectionKind: null, pendingParentPath: null, pendingNewContainer: null, pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
          });
          showMatchCountToast(containerName, matchCount);
        } else if (state.selectionKind === 'browserAction' && state.pendingBrowserActionIndex !== null) {
          // The action card already exists (kind chosen when it was added via
          // btn-add-action-*) — write the selector straight into the field
          // the pick button was for (pendingBrowserActionField — always
          // 'selector' except for a ScrollStep's two optional selectors), no
          // naming modal needed, same shape as the container branch above.
          // framePath is written unconditionally (even to null) rather than
          // merged: the backend models exactly one FramePath per ScrollStep,
          // shared by both ContainerSelector and LoadMoreButtonSelector (see
          // IR/BrowserAction.cs), so re-picking either selector re-records
          // which frame the *step* now targets.
          bridge.setState(STATES.IDLE, {
            browserActions: updateBrowserAction(state.browserActions, state.pendingBrowserActionIndex, {
              [state.pendingBrowserActionField]: message.selector,
              framePath,
            }),
            selectionKind: null, pendingBrowserActionIndex: null, pendingBrowserActionField: 'selector', pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
          });
        } else if (state.selectionKind === 'pagination') {
          // Issue #174 follow-up: lets a non-developer pick the "next page"
          // link by clicking it instead of having to know/type a CSS
          // selector — same "write straight into the one field, no naming
          // modal needed" shape as the browserAction branch above, just with
          // no index (there's only ever one nextLinkSelector).
          bridge.setState(STATES.IDLE, {
            pagination: { ...state.pagination, nextLinkSelector: message.selector },
            selectionKind: null, pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
          });
        } else {
          bridge.setState(STATES.SELECTING, {
            pendingSelector: message.selector, pendingFramePath: framePath, pendingMatchCount: matchCount,
            pendingRawText: typeof message.rawText === 'string' ? message.rawText : null,
            pendingElementAttributes: message.attributes ?? null,
            pendingOwnText: typeof message.ownText === 'string' ? message.ownText : null,
            pendingTransforms: [],
          });
        }
        if (message.path) highlightSelected(message.path);
      }
      if (message.type === 'DOM_TREE') {
        log('DOM_TREE received', { nodes: message.tree, truncated: message.truncated });
        cancelPendingDomTreeRequest();
        if (message.tree) {
          bridge.patchState({ domTree: message.tree, domTreeTruncated: !!message.truncated, domTreeError: null });
          renderDomTree(message.tree);
        } else {
          const reason = message.error || 'Tree could not be loaded.';
          setLastError(reason, 'DOM tree view');
          bridge.patchState({ domTreeError: reason });
        }
      }
      if (message.type === 'HOVER_ELEMENT') {
        highlightHover(message.path);
      }
      if (message.type === 'PREVIEW_RESULT' && state.previewActive) {
        log('PREVIEW_RESULT received', message);
        bridge.patchState({ previewSummary: { total: message.total, empty: message.empty, truncated: message.truncated } });
      }
      if (message.type === 'PREVIEW_UNAVAILABLE') {
        log('PREVIEW_UNAVAILABLE', message.reason);
        setLastError(message.reason, 'Preview');
        bridge.patchState({ previewActive: false, previewSummary: null });
        showToast(t('toast.previewUnavailable'), 'Preview');
      }
      if (message.type === 'API_CAPTURE_ENTRY' && state.apiCaptureActive) {
        log('API_CAPTURE_ENTRY received', message.entry?.url);
        bridge.patchState({ apiCaptureCount: state.apiCaptureCount + 1 });
      }
      if (message.type === 'API_CAPTURE_UNAVAILABLE') {
        log('API_CAPTURE_UNAVAILABLE', message.reason);
        setLastError(message.reason, 'Network recording');
        bridge.patchState({ apiCaptureActive: false, apiCaptureCount: 0 });
        showToast(t('toast.captureUnavailable'), 'Network recording');
      }
      // Issue #136: EMBEDDED_JSON_CANDIDATES is content-script.js's
      // findEmbeddedJsonCandidates counterpart to API_CANDIDATES — handled
      // identically here, since dispatch is entirely keyed off the shape of
      // state.apiSearchTarget (set by either startApiFieldSearch/
      // startEmbeddedJsonFieldSearch for 'field', or startApiTreeFieldSearch
      // for the tree-extension case), not off which message type arrived.
      if ((message.type === 'API_CANDIDATES' || message.type === 'EMBEDDED_JSON_CANDIDATES') && state.apiSearchTarget) {
        log(`${message.type} received`, { target: message.target, count: message.candidates?.length, for: state.apiSearchTarget });
        chrome.storage.session.remove('pendingSelector');
        const result = { target: message.target, candidates: message.candidates || [] };
        if (state.apiSearchTarget === 'field') {
          bridge.setState(STATES.IDLE, { apiSearchTarget: null, apiCandidates: result });
        } else if (state.apiSearchTarget.treeParentPath !== undefined) {
          // Issue #54, Phase A5 — "add root group"/"add sub-field", started
          // from STATES.API_CONFIG (see startApiTreeFieldSearch), returns there.
          bridge.setState(STATES.API_CONFIG, { apiSearchTarget: null, apiTreeSearchResult: { ...result, treeParentPath: state.apiSearchTarget.treeParentPath } });
        } else {
          // {parameter: partId} — the search was started from STATES.API_CONFIG
          // (see startDiscoverySearch), so it returns there, not to IDLE.
          bridge.setState(STATES.API_CONFIG, { apiSearchTarget: null, apiDiscoveryCandidates: { ...result, parameter: state.apiSearchTarget.parameter } });
        }
      }
    });
  }

  return { wireMessageListener };
})();

if (typeof module !== 'undefined') module.exports = SFMessageRouter;
if (typeof self !== 'undefined') self.SFMessageRouter = SFMessageRouter;
