// Pagination helpers (Issue #405) — DOM rendering and event wiring for the
// page-number template proposal, the "click a link to page 2" picker and the
// pieces of the Pagination / Discover-start-URLs blocks that changed with it
// (see pagination-template.ts for the pure derivation, settings-panel-ui.ts for
// the block's remaining inputs — the same <feature>.js/<feature>-ui.js split
// every other popup feature uses). Every function that touches state takes
// popup.js's `bridge` as its first parameter, per Architecture Decision #13.
//
// State this module reads/writes: `_state.pagination.linkHref` — UI-only, the
// absolute href of the last "next" / "page 2" link the user clicked, kept
// inside the pagination draft so it persists with it; buildPaginationConfig
// never sends it.
import type { PopupBridge, SelectionKind, State } from '../types/popup';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import { STATES } from './api-config';
import { detectPageTemplate, proposalAlreadyApplied } from './pagination-template';
import type { PageTemplateProposal } from './pagination-template';
import { byId, byIdOrNull } from './dom';

const log = createLogger('SF:Popup');

/**
 * The proposal worth showing for the current state, or null. A template that
 * leaves out {url} would request the same page N for every start page, so it
 * is not offered once there are several (additional or discovered ones).
 */
export function currentProposal(state: State): PageTemplateProposal | null {
  if (!state.pagination.enabled || state.mode === 'api' || state.mode === 'combined') return null;
  const found = detectPageTemplate({ currentUrl: state.url || '', linkHref: state.pagination.linkHref || '' });
  if (!found) return null;
  const severalStartPages = (state.additionalStartUrls || []).length > 0 || state.discoveredUrls?.enabled;
  if (severalStartPages && !found.usesStartUrl) return null;
  return proposalAlreadyApplied(state.pagination, found) ? null : found;
}

export function renderPaginationHelpers(bridge: PopupBridge): void {
  const state = bridge.getState();

  // The proposal banner.
  const banner = byIdOrNull('pagination-suggestion');
  if (banner) {
    const found = currentProposal(state);
    banner.classList.toggle('hidden', !found);
    if (found) {
      byId('pagination-suggestion-text').textContent = t('idle.paginationSuggestion');
      byId('pagination-suggestion-template').textContent = found.template;
      byId('pagination-suggestion-example').textContent = t('idle.paginationSuggestionExample', { example: found.example });
    }
  }

  // The picked "next" link, shown as a plain chip (its editable selector is under Advanced).
  const selected = byIdOrNull('pagination-next-link-selected');
  if (selected) {
    const selector = (state.pagination.nextLinkSelector || '').trim();
    selected.textContent = selector || t('browserActions.noSelector');
    selected.title = selected.textContent;
  }

  // Issue #405: "Discover start URLs" lives under Advanced — hidden with the
  // rest of its block for API/Combined/Blocks, and opened once when the
  // option is already on, so a returning user's setting is never tucked away.
  const advanced = byIdOrNull<HTMLDetailsElement>('discovered-urls-advanced');
  if (advanced) {
    advanced.classList.toggle('hidden', state.mode === 'api' || state.mode === 'combined' || state.mode === 'blocks');
    if (state.discoveredUrls.enabled && !advanced.open && !advanced.dataset.autoOpened) {
      advanced.dataset.autoOpened = '1';
      advanced.open = true;
    }
  }
}

function startLinkPick(bridge: PopupBridge, selectionKind: SelectionKind): void {
  bridge.stopPreviewIfActive();
  chrome.runtime.sendMessage({ type: 'START_SELECTION' });
  bridge.setState(STATES.SELECTING, {
    pendingSelector: null, pendingMatchCount: null, pendingRawText: null, pendingElementAttributes: null, pendingOwnText: null, pendingTransforms: [], selectionKind,
    domTree: null, domTreeTruncated: false, domTreeError: null,
  });
}

export function wirePaginationHelperEvents(bridge: PopupBridge): void {
  // Applying a proposal switches to the page-number kind and fills the template.
  byIdOrNull('btn-pagination-use-template')?.addEventListener('click', () => {
    const found = currentProposal(bridge.getState());
    if (!found) return;
    log('BTN pagination-use-template', found.template);
    bridge.setState(bridge.getState().current, {
      pagination: { ...bridge.getState().pagination, enabled: true, kind: 'pageNumber', urlTemplate: found.template },
    });
  });

  // "Click a link to page 2": learns the pattern from the link's address.
  byIdOrNull('btn-pick-pagination-page-link')?.addEventListener('click', () => {
    log('BTN pick-pagination-page-link → START_SELECTION');
    startLinkPick(bridge, 'paginationPageLink');
  });
}
