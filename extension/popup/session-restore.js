// ── Session-storage restore (popup reopen recovery) ──────────────────────────
// Extracted from popup.js (see CLAUDE.md's "Popup module boundaries"
// architecture decision) — init()'s chrome.storage.session recovery logic
// (restoring persisted fields/groups/settings, then replaying whichever
// pending-selector recovery branch applies) was the largest remaining chunk
// of popup.js not yet claimed by any feature module. It mirrors
// message-router.js's own ELEMENT_SELECTED branches closely (container node
// insertion, browser-action update, pagination update, generic field modal)
// — the same four outcomes, just replayed from chrome.storage.session after
// a popup reopen instead of from a live message — but stays a separate
// module since it's about *session restore*, not *live message dispatch*.
const SFSessionRestore = (function () {
  const { createLogger } = typeof require !== 'undefined' ? require('../shared/logger') : self.SFLogger;
  const log = createLogger('SF:Popup');
  const { STATES } = typeof require !== 'undefined' ? require('./api-config') : self.SFApiConfig;
  const { buildGroupNode, insertContainerNode } =
    typeof require !== 'undefined' ? require('./container-tree') : self.SFContainerTree;
  const { updateBrowserAction, computeInitialMonitoringSectionOpen } =
    typeof require !== 'undefined' ? require('./scraping-config-builder') : self.SFScrapingConfigBuilder;
  const { showMatchCountToast } = typeof require !== 'undefined' ? require('./toast') : self.SFToast;

  // Pure: folds chrome.storage.session's restored values onto a fresh
  // _state, the same "only overwrite what was actually persisted" shape
  // popup.js's own persistState() writes. Issue #183's one-time Monitoring-
  // section auto-expand is computed here too, since it depends on
  // changeDetection/hardening already being restored.
  function applyStoredSessionState(state, stored) {
    let next = state;
    if (Array.isArray(stored.fields)) next = { ...next, fields: stored.fields };
    if (Array.isArray(stored.groups)) next = { ...next, groups: stored.groups };
    if (stored.url)                   next = { ...next, url: stored.url };
    if (stored.mode)                  next = { ...next, mode: stored.mode };
    if (stored.engine)                next = { ...next, engine: stored.engine };
    if (Array.isArray(stored.browserActions)) next = { ...next, browserActions: stored.browserActions };
    if (Array.isArray(stored.additionalStartUrls)) next = { ...next, additionalStartUrls: stored.additionalStartUrls };
    if (stored.changeDetection) next = { ...next, changeDetection: stored.changeDetection };
    if (stored.proxy)                 next = { ...next, proxy: stored.proxy };
    if (stored.pagination)            next = { ...next, pagination: stored.pagination };
    if (stored.persistentSession !== undefined) next = { ...next, persistentSession: stored.persistentSession };
    if (stored.externalConfig !== undefined) next = { ...next, externalConfig: stored.externalConfig };
    if (stored.hardening)             next = { ...next, hardening: stored.hardening };
    if (stored.scriptFileName)        next = { ...next, scriptFileName: stored.scriptFileName };
    if (stored.outputFileName)        next = { ...next, outputFileName: stored.outputFileName };
    if (stored.selectionKind)         next = { ...next, selectionKind: stored.selectionKind };
    if (stored.pendingParentPath !== undefined) next = { ...next, pendingParentPath: stored.pendingParentPath };
    if (stored.pendingNewContainer)   next = { ...next, pendingNewContainer: stored.pendingNewContainer };
    if (stored.pendingBrowserActionIndex !== undefined) next = { ...next, pendingBrowserActionIndex: stored.pendingBrowserActionIndex };
    if (stored.pendingBrowserActionField)   next = { ...next, pendingBrowserActionField: stored.pendingBrowserActionField };
    if (stored.apiConfigDraft)        next = { ...next, apiConfigDraft: stored.apiConfigDraft };
    if (stored.apiConfig)             next = { ...next, apiConfig: stored.apiConfig };
    if (Array.isArray(stored.combinedComponents)) next = { ...next, combinedComponents: stored.combinedComponents };
    if (Array.isArray(stored.blocks))          next = { ...next, blocks: stored.blocks };
    if (stored.blocksDraftShape)               next = { ...next, blocksDraftShape: stored.blocksDraftShape };
    if (stored.blocksDraftName)                next = { ...next, blocksDraftName: stored.blocksDraftName };
    if (stored.blocksDraftOutputFileName)      next = { ...next, blocksDraftOutputFileName: stored.blocksDraftOutputFileName };
    if (stored.blocksEditingIndex !== undefined) next = { ...next, blocksEditingIndex: stored.blocksEditingIndex };

    // Issue #183: a returning user with something already configured in the
    // "Monitoring" section shouldn't have to re-expand it just to see it.
    if (computeInitialMonitoringSectionOpen(next.changeDetection, next.hardening)) {
      next = { ...next, monitoringSectionOpen: true };
    }
    return next;
  }

  // Replays whichever pending-selector outcome applies — the user clicked an
  // element while the side panel was closed (e.g. it hadn't finished loading
  // yet, or was closed manually). Call only after applyStoredSessionState has
  // already run, since these branches read bridge.getState()'s already-
  // restored groups/browserActions/pagination. Returns true if it fully
  // handled the recovery (init() should stop there, not fall through to its
  // own checkCompanion() call) — false when there was nothing pending.
  async function restorePendingSelection(bridge, stored) {
    if (!stored.pendingSelector) return false;
    await chrome.storage.session.remove('pendingSelector');
    const state = bridge.getState();

    if (stored.apiSearchTarget) {
      // Unlike the other pending-selector cases below, there's nothing to
      // recover here: the actual search result (API_CANDIDATES) is a
      // transient message content-script.js never persists anywhere, so a
      // leftover selector alone can't be turned into a candidate list —
      // discard it rather than misinterpret it as a flat-field pick.
      log('INIT pending API-search selector found, but candidates were never persisted — discarding');
      bridge.setState(state.apiConfigDraft ? STATES.API_CONFIG : STATES.IDLE, {});
      return true;
    }

    // Issue #182: same relaxation as message-router.js's own live-path
    // check — Blocks mode's own group-shaped draft reuses this identical
    // recovery branch.
    const isContainerOrBlocksGroupDraft = stored.mode === 'container' ||
      (stored.mode === 'blocks' && stored.blocksDraftShape === 'group');
    if (isContainerOrBlocksGroupDraft && stored.selectionKind === 'container' && stored.pendingNewContainer) {
      // Same as the live ELEMENT_SELECTED path: name/type were already
      // collected before selection started, so insert straight away.
      log('INIT pending container selector found → inserting node', stored.pendingSelector);
      const node = buildGroupNode(stored.pendingNewContainer.name, stored.pendingSelector, stored.pendingNewContainer.repeating, stored.pendingFramePath);
      const groups = insertContainerNode(state.groups, stored.pendingParentPath, node);
      await chrome.storage.session.set({ groups });
      bridge.setState(STATES.IDLE, {
        groups, selectionKind: null, pendingParentPath: null, pendingNewContainer: null, pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
      });
      showMatchCountToast(stored.pendingNewContainer.name, typeof stored.pendingMatchCount === 'number' ? stored.pendingMatchCount : null);
      return true;
    }

    if (stored.selectionKind === 'browserAction' && stored.pendingBrowserActionIndex !== null && stored.pendingBrowserActionIndex !== undefined) {
      // Same as the live ELEMENT_SELECTED path: the action card already
      // exists (kind chosen when it was added) — write the selector
      // straight into it, no naming modal needed.
      const field = stored.pendingBrowserActionField || 'selector';
      log('INIT pending browser-action selector found → updating action', { field, selector: stored.pendingSelector });
      const browserActions = updateBrowserAction(state.browserActions, stored.pendingBrowserActionIndex, {
        [field]: stored.pendingSelector, framePath: stored.pendingFramePath || null,
      });
      await chrome.storage.session.set({ browserActions });
      bridge.setState(STATES.IDLE, {
        browserActions, selectionKind: null, pendingBrowserActionIndex: null, pendingBrowserActionField: 'selector', pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
      });
      return true;
    }

    if (stored.selectionKind === 'pagination' && stored.pendingSelector) {
      // Same as the live ELEMENT_SELECTED path: write the picked selector
      // straight into pagination.nextLinkSelector, no naming modal needed.
      log('INIT pending pagination selector found → updating pagination', stored.pendingSelector);
      const pagination = { ...state.pagination, nextLinkSelector: stored.pendingSelector };
      await chrome.storage.session.set({ pagination });
      bridge.setState(STATES.IDLE, {
        pagination, selectionKind: null, pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
      });
      return true;
    }

    // Flat field or container field — show the (extended, in container
    // mode) field-name modal without re-checking the companion. The
    // transform chain itself is never persisted (see pendingTransforms'
    // own doc comment) — a reopened popup shows the modal with an empty
    // chain, same as the name input itself starting blank again.
    log('INIT pending selector found → show modal', stored.pendingSelector);
    bridge.setState(STATES.SELECTING, {
      pendingSelector: stored.pendingSelector, pendingFramePath: stored.pendingFramePath || null,
      pendingMatchCount: typeof stored.pendingMatchCount === 'number' ? stored.pendingMatchCount : null,
      pendingRawText: typeof stored.pendingRawText === 'string' ? stored.pendingRawText : null,
      pendingElementAttributes: stored.pendingElementAttributes ?? null,
      pendingOwnText: typeof stored.pendingOwnText === 'string' ? stored.pendingOwnText : null,
      pendingTransforms: [],
    });
    return true;
  }

  return { applyStoredSessionState, restorePendingSelection };
})();

if (typeof module !== 'undefined') module.exports = SFSessionRestore;
if (typeof self !== 'undefined') self.SFSessionRestore = SFSessionRestore;
