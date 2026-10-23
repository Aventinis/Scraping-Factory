// @ts-check
/** @import * as SFWire from '../types/wire' */
/** @import * as SFDraft from '../types/drafts' */
// API mode: cursor / token pagination — pure data / logic (api-cursor-pagination-ui.js renders it). Some APIs reveal the next
// page's identifier only in the current response (Relay's pageInfo.endCursor, next_page_token); see ApiConfig.CursorPagination.
//
// Draft (apiConfigDraft.cursorPagination, null = off):
//   { nextCursorPath, hasNextPagePath, target: 'Query' | 'Body', queryParameterName, bodyPath, maxPages }
// Page 1 is sent as recorded; from page 2 the cursor goes to `target`: a query parameter, or a dot path in a POST request's
// JSON body.
const DEFAULT_MAX_PAGES = 50;

// Last key of a leaf's path that looks like "the next page's cursor" /
// "is there a next page" (in a response), or like the request-side slot a
// cursor goes into. Deliberately conservative: a wrong suggestion costs
// the user a correction, a missed one just costs a manual entry.
const CURSOR_RESPONSE_KEY = /^(end_?cursor|next_?cursor|next_?page_?token|next_?token|next_?page_?cursor|continuation(_?token)?|cursor|next)$/i;
const HAS_NEXT_RESPONSE_KEY = /^(has_?next_?page|has_?more|has_?next|more)$/i;
const CURSOR_REQUEST_KEY = /^(cursor|after|page_?token|next_?token|starting_after|continuation(_?token)?|page_?cursor|start_?cursor)$/i;

/**
 * @returns {SFDraft.ApiCursorPagination}
 */
function createDefaultCursorDraft() {
  return {
    nextCursorPath: '', hasNextPagePath: '', target: 'Query', queryParameterName: '', bodyPath: '',
    maxPages: DEFAULT_MAX_PAGES,
  };
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function isValidQueryParameterName(name) {
  return name.length > 0 && !/[\s&=#?]/.test(name);
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isValidBodyPath(path) {
  return path.length > 0 && !path.includes('[') && path.split('.').every(segment => segment.trim().length > 0);
}

// Gates "Apply"; mirrors ScrapingPlanValidator.ValidateApiCursorPagination closely enough to avoid a 400. `context` describes the
// rest of the draft (a Body target needs a POST with a body).
/**
 * @param {SFDraft.ApiCursorPagination | null | undefined} draft
 * @param {{ method?: string, hasBodyTree?: boolean }} [context]
 * @returns {boolean}
 */
function cursorDraftIsComplete(draft, context = {}) {
  if (!draft) return true;
  if (!draft.nextCursorPath?.trim()) return false;
  if (!Number.isInteger(draft.maxPages) || draft.maxPages <= 0) return false;
  if (draft.target === 'Body') {
    return context.method === 'POST' && !!context.hasBodyTree && isValidBodyPath(draft.bodyPath?.trim() || '');
  }
  return isValidQueryParameterName(draft.queryParameterName?.trim() || '');
}

// Draft → wire ApiCursorPagination (companion/.../IR/ApiConfig.cs).
// hasNextPagePath is optional and omitted when blank; the target's own
// name/path key is sent only for the chosen target.
/**
 * @param {SFDraft.ApiCursorPagination | null | undefined} draft
 * @returns {SFWire.ApiCursorPagination | null}
 */
function buildApiCursorPagination(draft) {
  if (!draft) return null;
  const hasNextPagePath = draft.hasNextPagePath?.trim();
  return {
    nextCursorPath: draft.nextCursorPath.trim(),
    ...(hasNextPagePath ? { hasNextPagePath } : {}),
    target: draft.target,
    ...(draft.target === 'Body'
      ? { bodyPath: draft.bodyPath.trim() }
      : { queryParameterName: draft.queryParameterName.trim() }),
    maxPages: draft.maxPages,
  };
}

// Every scalar leaf (null included: Relay's "after" is null on page 1) with its path in the script's dot / [n] DSL. A path through an
// array contains '[' and is skipped by callers: a per-item cursor is not the page's.
/**
 * @param {*} value
 * @param {string} [path]
 * @param {Array<{path: string, key: string, value: *}>} [out]
 * @returns {Array<{path: string, key: string, value: *}>}
 */
function collectScalarLeaves(value, path = '', out = []) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectScalarLeaves(item, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => collectScalarLeaves(child, path ? `${path}.${key}` : key, out));
  } else {
    out.push({ path, key: path.split(/[.[]/).pop() || '', value });
  }
  return out;
}

/**
 * @param {*} json
 * @param {RegExp} keyPattern
 * @param {(value: *) => boolean} valueOk
 * @returns {string}
 */
function findLeafPath(json, keyPattern, valueOk) {
  const leaves = collectScalarLeaves(json).filter(leaf => !leaf.path.includes('[') && valueOk(leaf.value));
  // Prefer the most specific key (endCursor over a bare "next"), then the
  // shallowest path.
  const rank = (/** @type {string} */ key) => /cursor|token/i.test(key) ? 0 : 1;
  const matches = leaves.filter(leaf => keyPattern.test(leaf.key))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.path.split('.').length - b.path.split('.').length);
  return matches[0]?.path || '';
}

// Suggests a cursor configuration from one recorded pair: the next cursor and "has more" flag in the response and, if the request has
// a cursor-looking slot (query parameter or JSON body field), where to put it. Any part may be blank.
/**
 * @param {{ url?: string, method?: string, body?: string, requestBody?: string, requestBodySkipped?: boolean }} entry
 *   a GET_API_CAPTURE_ENTRIES entry
 * @param {Array<{ url?: string }>} [otherEntries] other recorded requests: when `entry` itself carries no
 *   cursor-looking query parameter (it is page 1), a later page of the same endpoint (same origin + path)
 *   usually does
 * @returns {{ nextCursorPath: string, hasNextPagePath: string, target: 'Query' | 'Body', queryParameterName: string, bodyPath: string }}
 */
function detectCursorSuggestion(entry, otherEntries = []) {
  let nextCursorPath = '';
  let hasNextPagePath = '';
  try {
    const response = JSON.parse(entry.body || '');
    nextCursorPath = findLeafPath(response, CURSOR_RESPONSE_KEY, v => typeof v === 'string' || typeof v === 'number');
    hasNextPagePath = findLeafPath(response, HAS_NEXT_RESPONSE_KEY, v => typeof v === 'boolean');
  } catch {
    // not a JSON response — the user types the paths themselves
  }

  let queryParameterName = '';
  try {
    const own = new URL(entry.url || '');
    const sameEndpoint = [entry, ...otherEntries].flatMap((candidate) => {
      try {
        const other = new URL(candidate.url || '');
        return other.origin === own.origin && other.pathname === own.pathname ? [other] : [];
      } catch {
        return [];
      }
    });
    queryParameterName = sameEndpoint
      .flatMap(url => Array.from(url.searchParams.keys()))
      .find(key => CURSOR_REQUEST_KEY.test(key)) || '';
  } catch {
    // unparsable URL — leave blank
  }

  let bodyPath = '';
  if (entry.method === 'POST' && !entry.requestBodySkipped && entry.requestBody) {
    try {
      bodyPath = findLeafPath(JSON.parse(entry.requestBody), CURSOR_REQUEST_KEY, () => true);
    } catch {
      // not a JSON body — leave blank
    }
  }

  // A POST body that carries a cursor slot is the more specific signal
  // (GraphQL's variables.after); otherwise a recorded query parameter wins.
  const target = bodyPath && !queryParameterName ? 'Body' : 'Query';
  return { nextCursorPath, hasNextPagePath, target, queryParameterName, bodyPath };
}

module.exports = {
  DEFAULT_MAX_PAGES,
  createDefaultCursorDraft, isValidQueryParameterName, isValidBodyPath, cursorDraftIsComplete,
  buildApiCursorPagination, collectScalarLeaves, detectCursorSuggestion,
};

