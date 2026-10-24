// API mode: Link-header pagination (Issue #321) — DOM rendering and event
// wiring for the "Follow the Link header" section on the API_CONFIG screen
// (see api-link-pagination.ts for the pure draft/wire logic, the same
// <feature>.js/<feature>-ui.js split api-cursor-pagination-ui.ts uses). Every
// function that touches state takes popup.js's `bridge` as its first
// parameter, per Architecture Decision #12.
//
// State this module owns:
//   apiConfigDraft.linkHeaderPagination — the draft (null = disabled)
// Reads (set by api-config-ui.ts when the candidate is confirmed):
//   apiConfigDraft.sourceHasNextLink — the recorded response carried a
//   rel="next" Link header, so the option is highlighted as a suggestion.
import type { PopupBridge } from '../types/popup';
import { patchApiConfigDraft } from './api-config-shared-ui';
import { createLogger } from '../shared/logger';
import { autoOpenAdvanced } from './advanced-disclosure-ui';
import { createDefaultLinkDraft, DEFAULT_MAX_PAGES } from './api-link-pagination';
import { byIdOrNull } from './dom';

const log = createLogger('SF:ApiLinkPaginationUI');

// Called from popup.js's render() while the API_CONFIG screen is showing.
// Hidden for an embedded-JSON source (a page load has no Link header to
// follow); a POST request keeps the section visible but disabled with an
// explanation, since the next page is requested by URL alone.
export function renderApiLinkPaginationSection(bridge: PopupBridge): void {
  const draft = bridge.getState().apiConfigDraft;
  const section = byIdOrNull('api-link-section');
  if (!section) return;
  // The section sits inside its "Advanced" disclosure — hide that whole block for an embedded source.
  (section.closest('details') || section).classList.toggle('hidden', !!draft?.embeddedJsonSource);
  const link = draft?.linkHeaderPagination || null;
  const isPost = (draft?.method || 'GET') !== 'GET';
  autoOpenAdvanced(section, !!link || (!!draft?.sourceHasNextLink && !isPost));

  const toggle = byIdOrNull<HTMLInputElement>('toggle-api-link');
  if (toggle) {
    toggle.checked = !!link;
    toggle.disabled = isPost;
  }
  byIdOrNull('api-link-post-hint')?.classList.toggle('hidden', !isPost);
  // A recorded response that actually announced a next page is worth a nudge.
  byIdOrNull('api-link-detected-hint')?.classList.toggle('hidden', !draft?.sourceHasNextLink || !!link || isPost);

  const configEl = byIdOrNull('api-link-config');
  if (!configEl) return;
  configEl.classList.toggle('hidden', !link);
  const maxPages = byIdOrNull<HTMLInputElement>('input-api-link-max-pages');
  if (maxPages && link && document.activeElement !== maxPages) maxPages.value = String(link.maxPages);
}

// ── Actions ─────────────────────────────────────────────────────────────────

// Mutually exclusive with cursor pagination: enabling one drops the other.
function setLinkEnabled(bridge: PopupBridge, enabled: boolean): void {
  log('API_LINK toggle', enabled);
  patchApiConfigDraft(bridge, enabled
    ? { linkHeaderPagination: createDefaultLinkDraft(), cursorPagination: null }
    : { linkHeaderPagination: null });
}

function setMaxPages(bridge: PopupBridge, value: string): void {
  const parsed = parseInt(value, 10);
  patchApiConfigDraft(bridge, { linkHeaderPagination: { maxPages: Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PAGES } });
}

// ── Event wiring ────────────────────────────────────────────────────────────

export function wireApiLinkPaginationEvents(bridge: PopupBridge): void {
  const section = byIdOrNull('api-link-section');
  if (!section) return;
  section.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.id === 'toggle-api-link') setLinkEnabled(bridge, target.checked);
    else if (target.id === 'input-api-link-max-pages') setMaxPages(bridge, target.value);
  });
}
