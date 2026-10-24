// ── Inbound content-script / service-worker message dispatch ──
// The single chrome.runtime.onMessage listener for everything the content script and service worker send back (selection
// results, DOM tree data, preview / API-capture results, ...). Cross-cutting, so its own module. Takes a `bridge`.
import type { PopupBridge } from '../types/popup';
import type { PopupInboundMessage } from '../types/messages';
import type { ApiConfigDraft } from './api-config';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import { STATES } from './api-config';
import { buildGroupNode, insertContainerNode } from './container-tree';
import { updateBrowserAction, computeScriptFileNamePatch } from './scraping-config-builder';
import { getGlobalSettings } from '../shared/global-settings';
import { resolveLinkHref } from './pagination-template';
import { showToast, showMatchCountToast, setLastError } from './toast';
import { markPickHandled, withDiscoveryActionPatch } from './session-restore';
import { cancelPendingDomTreeRequest, renderDomTree, highlightHover, highlightSelected } from './dom-tree-ui';

const log = createLogger('SF:Popup');

export function wireMessageListener(bridge: PopupBridge): void {
  chrome.runtime.onMessage.addListener((message: PopupInboundMessage) => {
    log('MSG_IN', message);
    const state = bridge.getState();
    if (message.type === 'SELECTION_UNAVAILABLE' && state.current === STATES.SELECTING) {
      log('SELECTION_UNAVAILABLE', message.reason);
      setLastError(message.reason, 'Element selection');
      const returnTo = state.apiConfigDraft ? STATES.API_CONFIG : STATES.IDLE;
      bridge.setState(returnTo, {
        selectionKind: null, pendingParentPath: null, pendingNewContainer: null,
        pendingBrowserActionIndex: null, pendingBrowserActionField: 'selector', apiSearchTarget: null,
        pendingApiDiscoveryPartId: null, pendingApiDiscoveryActionIndex: null, pendingApiDiscoveryActionField: 'selector',
      });
      // retryScopeSelector tags its "retried and still nothing" case with unavailableKind, unlike the service worker's other
      // SELECTION_UNAVAILABLE (no content script at all). A scope selector can fail repeatedly for page-specific reasons outside our
      // control (e.g. a class present only while hovered), so it is a softer warning without "Report bug".
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
      // Issue #429: the service worker's fallback write of this pick can still land after the
      // cleanup below; recording the pick as handled makes such a leftover harmless.
      markPickHandled(message.pickId);
      if (state.apiSearchTarget) {
        // API-mode search: content-script.ts always sends this too (same
        // click), but the actual result arrives as a separate API_CANDIDATES
        // message right after — handled below, nothing to do with the plain
        // selector here.
        return;
      }
      // Clear the storage entry the service worker wrote — we have it now.
      chrome.storage.session.remove('pendingSelector');
      // _state.url is set once, at panel load; with no chrome.tabs.onUpdated listener it goes stale if the tab navigates while the panel
      // stays open. The picked element's own page (message.url) is ground truth: self-correct, instead of a /generate against the wrong
      // page ending in a confusing "no data".
      if (typeof message.url === 'string' && message.url && message.url !== state.url) {
        log('ELEMENT_SELECTED page changed since last sync', { from: state.url, to: message.url });
        // The default-script-name preference applies here too: a new site mid-session counts like the initial detection.
        const scriptFileNamePatch = computeScriptFileNamePatch(state.scriptFileName, message.url, getGlobalSettings());
        bridge.setState(STATES.SELECTING, { url: message.url, ...scriptFileNamePatch });
        showToast(t('toast.trackedUrlUpdated', { url: message.url }), null, 'info');
      }
      const framePath = message.framePath || null;
      const matchCount = typeof message.matchCount === 'number' ? message.matchCount : null;
      // Blocks mode reuses this flow when its draft shape is 'group' (state.groups is then the draft).
      if ((state.mode === 'container' || (state.mode === 'blocks' && state.blocksDraftShape === 'group')) && state.selectionKind === 'container') {
        // Name and type came from modal-container-new, so the node is inserted straight away; the match count becomes a toast (read the
        // name before setState() clears pendingNewContainer).
        const pendingContainer = state.pendingNewContainer!; // set by modal-container-new before a container pick starts
        const containerName = pendingContainer.name;
        const containerRepeating = pendingContainer.repeating;
        const node = buildGroupNode(pendingContainer.name, message.selector, pendingContainer.repeating, framePath);
        bridge.setState(STATES.IDLE, {
          groups: insertContainerNode(state.groups, state.pendingParentPath, node),
          selectionKind: null, pendingParentPath: null, pendingNewContainer: null, pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
        });
        showMatchCountToast(containerName, matchCount, containerRepeating);
      } else if (state.selectionKind === 'browserAction' && state.pendingBrowserActionIndex !== null) {
        // The action card exists already: write the selector into the field the pick button was for (pendingBrowserActionField), no modal.
        // framePath is written unconditionally: a ScrollStep has one FramePath shared by both selectors, so re-picking either re-records it.
        bridge.setState(STATES.IDLE, {
          browserActions: updateBrowserAction(state.browserActions, state.pendingBrowserActionIndex, {
            [state.pendingBrowserActionField]: message.selector,
            framePath,
          }),
          selectionKind: null, pendingBrowserActionIndex: null, pendingBrowserActionField: 'selector', pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
        });
      } else if (state.selectionKind === 'apiDiscoveryAction' && state.pendingApiDiscoveryPartId !== null && state.pendingApiDiscoveryActionIndex !== null) {
        // Same as the browserAction branch, one level deeper (a BrowserDiscoverySource's action list) and back to API_CONFIG.
        const partId = state.pendingApiDiscoveryPartId;
        const draft = state.apiConfigDraft as ApiConfigDraft; // an apiDiscoveryAction pick only starts from API_CONFIG, where the draft exists
        bridge.setState(STATES.API_CONFIG, {
          apiConfigDraft: withDiscoveryActionPatch(draft, partId, state.pendingApiDiscoveryActionIndex, {
            [state.pendingApiDiscoveryActionField]: message.selector,
            framePath,
          }),
          selectionKind: null, pendingApiDiscoveryPartId: null, pendingApiDiscoveryActionIndex: null, pendingApiDiscoveryActionField: 'selector',
          pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
        });
      } else if (state.selectionKind === 'paginationPageLink') {
        // Issue #405: a link to page 2 — only its address is wanted (the
        // page-number template is derived from it, see pagination-template.ts).
        const linkHref = resolveLinkHref(message.attributes?.href || '', message.url || state.url || '');
        if (!linkHref) showToast(t('toast.paginationNotALink'), null, 'warn');
        bridge.setState(STATES.IDLE, {
          pagination: { ...state.pagination, linkHref },
          selectionKind: null, pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
        });
      } else if (state.selectionKind === 'pagination') {
        // Picks the "next page" link by clicking it; writes the one nextLinkSelector field, no modal.
        bridge.setState(STATES.IDLE, {
          // Issue #405: the clicked link's own address feeds the page-number proposal.
          pagination: { ...state.pagination, nextLinkSelector: message.selector, linkHref: resolveLinkHref(message.attributes?.href || '', message.url || state.url || '') },
          selectionKind: null, pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
        });
      } else if (state.selectionKind === 'discoveredUrls') {
        // Picks a navigation link by clicking: writes the clicked page's URL (message.url) and the selector; avoidId keeps the selector
        // generalized across sibling links.
        bridge.setState(STATES.IDLE, {
          discoveredUrls: {
            ...state.discoveredUrls,
            pageUrl: message.url || state.discoveredUrls.pageUrl,
            linkSelector: message.selector,
          },
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
    // EMBEDDED_JSON_CANDIDATES is handled like API_CANDIDATES: dispatch depends on state.apiSearchTarget, not the message type.
    if ((message.type === 'API_CANDIDATES' || message.type === 'EMBEDDED_JSON_CANDIDATES') && state.apiSearchTarget) {
      log(`${message.type} received`, { target: message.target, count: message.candidates?.length, for: state.apiSearchTarget });
      chrome.storage.session.remove('pendingSelector');
      const result = { target: message.target, candidates: message.candidates || [] };
      if (state.apiSearchTarget === 'field') {
        bridge.setState(STATES.IDLE, { apiSearchTarget: null, apiCandidates: result });
      } else if (typeof state.apiSearchTarget === 'object' && 'treeParentPath' in state.apiSearchTarget) {
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
