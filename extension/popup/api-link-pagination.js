// @ts-check
// API mode: Link-header pagination (Issue #321) — pure data/logic only, no DOM
// (see api-link-pagination-ui.js for rendering/event wiring, the same
// <feature>.js/<feature>-ui.js split api-cursor-pagination.js uses). Many REST
// APIs (GitHub, GitLab, WordPress, ...) announce the next page in the HTTP
// `Link: <url>; rel="next"` response header instead of in the body, so the
// generated script follows that URL page after page — see
// ApiConfig.LinkHeaderPagination in IR/ApiConfig.cs.
//
// Draft shape (apiConfigDraft.linkHeaderPagination, null = disabled):
//   { maxPages }
// Page 1 is always sent exactly as recorded. Mutually exclusive with cursor
// pagination (the draft only ever carries one of the two) and GET-only.
const DEFAULT_MAX_PAGES = 50;

/**
 * @returns {SFDraft.ApiLinkHeaderPagination}
 */
function createDefaultLinkDraft() {
  return { maxPages: DEFAULT_MAX_PAGES };
}

// Gates the API_CONFIG screen's "Apply" alongside the other draft checks —
// mirrors ScrapingPlanValidator's ValidateApiLinkHeaderPagination closely
// enough that a draft passing here won't get a 400 back from /generate.
/**
 * @param {SFDraft.ApiLinkHeaderPagination | null | undefined} draft
 * @param {{ method?: string, embeddedJsonSource?: unknown, cursorPagination?: unknown }} [context]
 * @returns {boolean}
 */
function linkDraftIsComplete(draft, context = {}) {
  if (!draft) return true;
  if (!Number.isInteger(draft.maxPages) || draft.maxPages <= 0) return false;
  if ((context.method || 'GET') !== 'GET') return false;
  return !context.embeddedJsonSource && !context.cursorPagination;
}

// Draft → wire ApiLinkHeaderPagination (companion/.../IR/ApiConfig.cs).
/**
 * @param {SFDraft.ApiLinkHeaderPagination | null | undefined} draft
 * @returns {SFWire.ApiLinkHeaderPagination | null}
 */
function buildApiLinkHeaderPagination(draft) {
  return draft ? { maxPages: draft.maxPages } : null;
}

module.exports = { DEFAULT_MAX_PAGES, createDefaultLinkDraft, linkDraftIsComplete, buildApiLinkHeaderPagination };

