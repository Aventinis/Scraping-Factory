// API mode: Link-header pagination — pure data/logic, no DOM (rendering is api-link-pagination-ui.js). Many REST APIs announce
// the next page in the `Link: <url>; rel="next"` response header instead of the body; the generated script follows it page
// after page (ApiConfig.LinkHeaderPagination in IR/ApiConfig.cs). The draft (apiConfigDraft.linkHeaderPagination, null =
// disabled) is just { maxPages }. Page 1 is sent exactly as recorded; GET only, and exclusive with cursor pagination.

export const DEFAULT_MAX_PAGES = 50;

export function createDefaultLinkDraft(): SFDraft.ApiLinkHeaderPagination {
  return { maxPages: DEFAULT_MAX_PAGES };
}

/** Gates "Apply" on the API_CONFIG screen; mirrors ValidateApiLinkHeaderPagination closely enough to avoid a 400. */
export function linkDraftIsComplete(
  draft: SFDraft.ApiLinkHeaderPagination | null | undefined,
  context: { method?: string; embeddedJsonSource?: unknown; cursorPagination?: unknown } = {},
): boolean {
  if (!draft) return true;
  if (!Number.isInteger(draft.maxPages) || draft.maxPages <= 0) return false;
  if ((context.method || 'GET') !== 'GET') return false;
  return !context.embeddedJsonSource && !context.cursorPagination;
}

export function buildApiLinkHeaderPagination(draft: SFDraft.ApiLinkHeaderPagination | null | undefined): SFWire.ApiLinkHeaderPagination | null {
  return draft ? { maxPages: draft.maxPages } : null;
}
