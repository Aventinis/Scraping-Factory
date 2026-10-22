// API mode: Link-header pagination (Issue #321) — DOM rendering and event
// wiring for the "Follow the Link header" section on the API_CONFIG screen
// (see api-link-pagination.js for the pure draft/wire logic, the same
// <feature>.js/<feature>-ui.js split api-cursor-pagination-ui.js uses). Every
// function that touches state takes popup.js's `bridge` as its first
// parameter, per Architecture Decision #12.
//
// State this module owns:
//   apiConfigDraft.linkHeaderPagination — the draft (null = disabled)
// Reads (set by api-config-ui.js when the candidate is confirmed):
//   apiConfigDraft.sourceHasNextLink — the recorded response carried a
//   rel="next" Link header, so the option is highlighted as a suggestion.
const { createLogger } = require('../shared/logger');
const { autoOpenAdvanced } = require('./api-config-shared-ui');
const log = createLogger('SF:ApiLinkPaginationUI');
const { createDefaultLinkDraft, DEFAULT_MAX_PAGES } = require('./api-link-pagination');

function patchDraft(bridge, patch) {
  const state = bridge.getState();
  bridge.setState(state.current, { apiConfigDraft: { ...state.apiConfigDraft, ...patch } });
}

// Called from popup.js's render() while the API_CONFIG screen is showing.
// Hidden for an embedded-JSON source (a page load has no Link header to
// follow); a POST request keeps the section visible but disabled with an
// explanation, since the next page is requested by URL alone.
function renderApiLinkPaginationSection(bridge) {
  const draft = bridge.getState().apiConfigDraft;
  const section = document.getElementById('api-link-section');
  if (!section) return;
  // The section sits inside its "Advanced" disclosure — hide that whole block for an embedded source.
  (section.closest('details') || section).classList.toggle('hidden', !!draft?.embeddedJsonSource);
  const link = draft?.linkHeaderPagination || null;
  const isPost = (draft?.method || 'GET') !== 'GET';
  autoOpenAdvanced(section, !!link || (!!draft?.sourceHasNextLink && !isPost));

  const toggle = /** @type {HTMLInputElement | null} */ (document.getElementById('toggle-api-link'));
  if (toggle) {
    toggle.checked = !!link;
    toggle.disabled = isPost;
  }
  document.getElementById('api-link-post-hint')?.classList.toggle('hidden', !isPost);
  // A recorded response that actually announced a next page is worth a nudge.
  document.getElementById('api-link-detected-hint')?.classList.toggle('hidden', !draft?.sourceHasNextLink || !!link || isPost);

  const configEl = document.getElementById('api-link-config');
  if (!configEl) return;
  configEl.classList.toggle('hidden', !link);
  const maxPages = /** @type {HTMLInputElement | null} */ (document.getElementById('input-api-link-max-pages'));
  if (maxPages && link && document.activeElement !== maxPages) maxPages.value = String(link.maxPages);
}

// ── Actions ─────────────────────────────────────────────────────────────────

// Mutually exclusive with cursor pagination: enabling one drops the other.
function setLinkEnabled(bridge, enabled) {
  log('API_LINK toggle', enabled);
  patchDraft(bridge, enabled
    ? { linkHeaderPagination: createDefaultLinkDraft(), cursorPagination: null }
    : { linkHeaderPagination: null });
}

function setMaxPages(bridge, value) {
  const parsed = parseInt(value, 10);
  patchDraft(bridge, { linkHeaderPagination: { maxPages: Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PAGES } });
}

// ── Event wiring ────────────────────────────────────────────────────────────

function wireApiLinkPaginationEvents(bridge) {
  const section = document.getElementById('api-link-section');
  if (!section) return;
  section.addEventListener('change', (e) => {
    const target = /** @type {HTMLInputElement} */ (e.target);
    if (target.id === 'toggle-api-link') setLinkEnabled(bridge, target.checked);
    else if (target.id === 'input-api-link-max-pages') setMaxPages(bridge, target.value);
  });
}

module.exports = { renderApiLinkPaginationSection, wireApiLinkPaginationEvents };

