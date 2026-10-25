// ── Session-storage restore (popup reopen recovery) ──
// init()'s chrome.storage.session recovery: restore persisted fields / groups / settings, then replay the pending-selector outcome.
// It mirrors message-router.ts's ELEMENT_SELECTED branches (container insert, browser action, pagination, field modal), replayed
// from storage after a reopen instead of from a live message, hence its own module.
import type * as SFDraft from '../types/drafts';
import type { PopupBridge, State } from '../types/popup';
import type { ApiConfigDraft, SourceOf } from './api-config';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import { STATES } from './api-config';
import { buildGroupNode, insertContainerNode } from './container-tree';
import { updateBrowserAction, computeInitialMonitoringSectionOpen } from './scraping-config-builder';
import { showToast, showMatchCountToast } from './toast';
import { resolveLinkHref } from './pagination-template';

const log = createLogger('SF:Popup');

// What persistState() writes to chrome.storage.session, plus what the service worker writes there when a pick happens while the
// panel is closed (the pending* selection and its page).
export type StoredSession = Partial<Pick<State,
  | 'fields' | 'url' | 'mode' | 'groups' | 'engine' | 'browserActions' | 'additionalStartUrls' | 'changeDetection' | 'proxy'
  | 'requestDelay' | 'retry' | 'deduplication' | 'requestHeaders' | 'pagination' | 'discoveredUrls' | 'persistentSession' | 'preflight'
  | 'respectRobotsDelay' | 'robotsDisallow' | 'appendOutput' | 'hardening' | 'scriptFileName' | 'outputFileName' | 'selectionKind'
  | 'pendingParentPath' | 'pendingNewContainer' | 'pendingBrowserActionIndex' | 'pendingBrowserActionField'
  | 'pendingApiDiscoveryPartId' | 'pendingApiDiscoveryActionIndex' | 'pendingApiDiscoveryActionField' | 'apiSearchTarget'
  | 'apiConfigDraft' | 'apiConfig' | 'combinedComponents' | 'blocks' | 'blocksDraftShape' | 'blocksDraftName'
  | 'blocksDraftOutputFileName' | 'blocksEditingIndex' | 'selectedOutputBlueprintId' | 'selectedOutputBlueprintFieldNames'
  | 'outputBlueprintMapping' | 'pendingElementAttributes' | 'pendingFramePath' | 'pendingSelector'>> & {
  // Written by the service worker from the page, so only checked with typeof where they are read.
  pendingMatchCount?: unknown;
  pendingRawText?: unknown;
  pendingOwnText?: unknown;
  pendingUrl?: string;
  pendingPickId?: unknown;
  handledPickId?: unknown;
};

// A browser-discovery source's action list is edited in draft shape while the API_CONFIG screen is open and only serialized on Apply.
export function withDiscoveryActionPatch(
  draft: ApiConfigDraft, partId: string, index: number, patch: Partial<SFDraft.BrowserAction>,
): ApiConfigDraft {
  const source = draft.parameterSources[partId] as SourceOf<'browserDiscovery'>; // only called for a browser-discovery part
  return {
    ...draft,
    parameterSources: {
      ...draft.parameterSources,
      [partId]: { ...source, actions: updateBrowserAction(source.actions || [], index, patch) },
    },
  };
}

// Pure: folds the restored values onto a fresh _state, overwriting only what was persisted (like persistState()). Also computes
// the one-time Monitoring-section auto-expand, which needs changeDetection / hardening restored.
export function applyStoredSessionState(state: State, stored: StoredSession): State {
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
  if (stored.requestDelay)          next = { ...next, requestDelay: stored.requestDelay };
  if (stored.retry)                 next = { ...next, retry: stored.retry };
  if (stored.deduplication)         next = { ...next, deduplication: stored.deduplication };
  if (stored.requestHeaders)        next = { ...next, requestHeaders: stored.requestHeaders };
  if (stored.pagination)            next = { ...next, pagination: stored.pagination };
  if (stored.discoveredUrls)        next = { ...next, discoveredUrls: stored.discoveredUrls };
  if (stored.persistentSession !== undefined) next = { ...next, persistentSession: stored.persistentSession };
  if (stored.preflight !== undefined) next = { ...next, preflight: stored.preflight };
  if (stored.respectRobotsDelay !== undefined) next = { ...next, respectRobotsDelay: stored.respectRobotsDelay };
  if (stored.robotsDisallow)        next = { ...next, robotsDisallow: stored.robotsDisallow };
  if (stored.appendOutput !== undefined) next = { ...next, appendOutput: stored.appendOutput };
  if (stored.hardening)             next = { ...next, hardening: stored.hardening };
  if (stored.scriptFileName)        next = { ...next, scriptFileName: stored.scriptFileName };
  if (stored.outputFileName)        next = { ...next, outputFileName: stored.outputFileName };
  if (stored.selectionKind)         next = { ...next, selectionKind: stored.selectionKind };
  if (stored.pendingParentPath !== undefined) next = { ...next, pendingParentPath: stored.pendingParentPath };
  if (stored.pendingNewContainer)   next = { ...next, pendingNewContainer: stored.pendingNewContainer };
  if (stored.pendingBrowserActionIndex !== undefined) next = { ...next, pendingBrowserActionIndex: stored.pendingBrowserActionIndex };
  if (stored.pendingBrowserActionField)   next = { ...next, pendingBrowserActionField: stored.pendingBrowserActionField };
  if (stored.pendingApiDiscoveryPartId !== undefined) next = { ...next, pendingApiDiscoveryPartId: stored.pendingApiDiscoveryPartId };
  if (stored.pendingApiDiscoveryActionIndex !== undefined) next = { ...next, pendingApiDiscoveryActionIndex: stored.pendingApiDiscoveryActionIndex };
  if (stored.pendingApiDiscoveryActionField) next = { ...next, pendingApiDiscoveryActionField: stored.pendingApiDiscoveryActionField };
  if (stored.apiConfigDraft)        next = { ...next, apiConfigDraft: stored.apiConfigDraft };
  if (stored.apiConfig)             next = { ...next, apiConfig: stored.apiConfig };
  if (Array.isArray(stored.combinedComponents)) next = { ...next, combinedComponents: stored.combinedComponents };
  if (Array.isArray(stored.blocks))          next = { ...next, blocks: stored.blocks };
  if (stored.blocksDraftShape)               next = { ...next, blocksDraftShape: stored.blocksDraftShape };
  if (stored.blocksDraftName)                next = { ...next, blocksDraftName: stored.blocksDraftName };
  if (stored.blocksDraftOutputFileName)      next = { ...next, blocksDraftOutputFileName: stored.blocksDraftOutputFileName };
  if (stored.blocksEditingIndex !== undefined) next = { ...next, blocksEditingIndex: stored.blocksEditingIndex };
  if (stored.selectedOutputBlueprintId) next = { ...next, selectedOutputBlueprintId: stored.selectedOutputBlueprintId };
  if (Array.isArray(stored.selectedOutputBlueprintFieldNames)) next = { ...next, selectedOutputBlueprintFieldNames: stored.selectedOutputBlueprintFieldNames };
  if (stored.outputBlueprintMapping) next = { ...next, outputBlueprintMapping: stored.outputBlueprintMapping };

  // Issue #183: a returning user with something already configured in the
  // "Monitoring" section shouldn't have to re-expand it just to see it.
  if (computeInitialMonitoringSectionOpen(next.changeDetection, next.hardening)) {
    next = { ...next, monitoringSectionOpen: true };
  }
  return next;
}

// Replays the pending-selector outcome for an element picked while the panel was closed. Call after applyStoredSessionState (the
// branches read the restored groups / actions / pagination). Returns true if it fully handled the recovery (init() stops there).
// The service worker writes pendingSelector as a fallback while the live message reaches an open panel, and the panel's cleanup can
// run before that write lands: the panel records the pick it handled (handledPickId), and a stored selector of that pick is a
// leftover, not a pending selection.
export function isLeftoverOfHandledPick(stored: StoredSession): boolean {
  return typeof stored.pendingPickId === 'string' && stored.pendingPickId === stored.handledPickId;
}

export function markPickHandled(pickId: unknown): void {
  if (typeof pickId !== 'string' || !pickId) return;
  chrome.storage.session.set({ handledPickId: pickId });
}

export async function restorePendingSelection(bridge: PopupBridge, stored: StoredSession): Promise<boolean> {
  if (!stored.pendingSelector) return false;
  if (isLeftoverOfHandledPick(stored)) {
    log('INIT pending selector belongs to an already handled pick — discarding', stored.pendingPickId);
    await chrome.storage.session.remove('pendingSelector');
    return false;
  }
  await chrome.storage.session.remove('pendingSelector');
  markPickHandled(stored.pendingPickId);
  const state = bridge.getState();

  // Same stale-URL self-correction as message-router.ts, from the persisted pendingUrl. patchState is enough: the branch below
  // persists the corrected url with its own setState.
  if (typeof stored.pendingUrl === 'string' && stored.pendingUrl && stored.pendingUrl !== state.url) {
    log('INIT pending selector\'s page changed since last sync', { from: state.url, to: stored.pendingUrl });
    bridge.patchState({ url: stored.pendingUrl });
    showToast(t('toast.trackedUrlUpdated', { url: stored.pendingUrl }), null, 'info');
  }

  if (stored.apiSearchTarget) {
    // Nothing to recover: API_CANDIDATES is transient and never persisted, so a leftover selector cannot become a candidate list; discard
    // it rather than misread it as a flat-field pick.
    log('INIT pending API-search selector found, but candidates were never persisted — discarding');
    bridge.setState(state.apiConfigDraft ? STATES.API_CONFIG : STATES.IDLE, {});
    return true;
  }

  // Issue #182: same relaxation as message-router.ts's own live-path
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
    showMatchCountToast(stored.pendingNewContainer.name, typeof stored.pendingMatchCount === 'number' ? stored.pendingMatchCount : null, stored.pendingNewContainer.repeating);
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

  if (stored.selectionKind === 'apiDiscoveryAction' && stored.pendingApiDiscoveryPartId && stored.pendingApiDiscoveryActionIndex !== null && stored.pendingApiDiscoveryActionIndex !== undefined) {
    // Issue #216: same as the live ELEMENT_SELECTED path, nested one
    // level deeper (one specific BrowserDiscoverySource's own action
    // list) and returning to API_CONFIG, where this picker lives.
    const partId = stored.pendingApiDiscoveryPartId;
    const field = stored.pendingApiDiscoveryActionField || 'selector';
    const draft = state.apiConfigDraft as ApiConfigDraft; // an apiDiscoveryAction pick only starts from API_CONFIG, where the draft exists
    log('INIT pending api-discovery-action selector found → updating action', { partId, field, selector: stored.pendingSelector });
    const apiConfigDraft = withDiscoveryActionPatch(draft, partId, stored.pendingApiDiscoveryActionIndex, {
      [field]: stored.pendingSelector, framePath: stored.pendingFramePath || null,
    });
    await chrome.storage.session.set({ apiConfigDraft });
    bridge.setState(STATES.API_CONFIG, {
      apiConfigDraft, selectionKind: null, pendingApiDiscoveryPartId: null, pendingApiDiscoveryActionIndex: null, pendingApiDiscoveryActionField: 'selector',
      pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
    });
    return true;
  }

  if (stored.selectionKind === 'paginationPageLink' && stored.pendingSelector) {
    // Issue #405: same as the live path — only the clicked link's address is kept.
    log('INIT pending pagination page link found → updating pagination');
    const pagination = { ...state.pagination, linkHref: resolveLinkHref(stored.pendingElementAttributes?.href || '', state.url || '') };
    await chrome.storage.session.set({ pagination });
    bridge.setState(STATES.IDLE, {
      pagination, selectionKind: null, pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
    });
    return true;
  }

  if (stored.selectionKind === 'pagination' && stored.pendingSelector) {
    // Same as the live ELEMENT_SELECTED path: write the picked selector
    // straight into pagination.nextLinkSelector, no naming modal needed.
    log('INIT pending pagination selector found → updating pagination', stored.pendingSelector);
    const pagination = {
      ...state.pagination,
      nextLinkSelector: stored.pendingSelector,
      linkHref: resolveLinkHref(stored.pendingElementAttributes?.href || '', state.url || ''), // Issue #405
    };
    await chrome.storage.session.set({ pagination });
    bridge.setState(STATES.IDLE, {
      pagination, selectionKind: null, pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
    });
    return true;
  }

  if (stored.selectionKind === 'discoveredUrls' && stored.pendingSelector) {
    // Same as the live ELEMENT_SELECTED path: write the picked selector
    // and the clicked page's own URL (already self-corrected into
    // state.url by the block above, if it had changed) straight into
    // discoveredUrls, no naming modal needed.
    log('INIT pending discoveredUrls selector found → updating discoveredUrls', stored.pendingSelector);
    const discoveredUrls = {
      ...state.discoveredUrls,
      pageUrl: stored.pendingUrl || state.discoveredUrls.pageUrl,
      linkSelector: stored.pendingSelector,
    };
    await chrome.storage.session.set({ discoveredUrls });
    bridge.setState(STATES.IDLE, {
      discoveredUrls, selectionKind: null, pendingSelector: null, pendingFramePath: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [],
    });
    return true;
  }

  // Flat or container field: show the field modal without re-checking the companion. The transform chain is never persisted, so the
  // modal reopens with an empty chain, like the blank name input.
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
