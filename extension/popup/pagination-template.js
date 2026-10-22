// @ts-check
// Page-number template derivation (Issue #405) — pure data/logic only, no DOM
// (see pagination-ui.js for the rendering). The "Page-number URL" pagination
// kind needs a template with a {page} placeholder (and, optionally, {url} for
// the start page as-is); a non-developer can't be expected to know how a
// site's page URLs look, so this proposes one from what the extension can
// already see: the tracked page's URL and, when the user clicked one, the
// href of a "next" / "page 2" link.
//
// Only ever a *proposal* — never applied by itself — and deliberately
// conservative: anything ambiguous (zero-based counters, offsets, several
// plausible parameters, a #fragment in the way) returns null instead of a
// guess. {page} counts from 2 in the generated script (page 1 is always the
// start URL exactly as given), so a proposal must make page 2 the second page.

// Query parameter names that, by convention, carry a page number.
const PAGE_PARAM_NAMES = ['page', 'p', 'pg', 'paged', 'pagenum', 'pagenumber', 'pageno', 'seite', 'pagina', 'currentpage'];
// Path words ("/page/2/", "/seite/2") that carry one.
const PAGE_PATH_WORDS = ['page', 'seite', 'pagina', 'p'];

const PATH_SEGMENT_PATTERN = new RegExp(`/(${PAGE_PATH_WORDS.join('|')})/(\\d+)(?=/|$)`, 'i');

/**
 * @typedef {Object} PageTemplateProposal
 * @property {string} template  the URL template, with {page} (and {url} when it appends to the start URL)
 * @property {'query' | 'path'} style
 * @property {boolean} usesStartUrl  whether the template contains {url}
 * @property {string} example  what page 2 would be requested as
 */

/**
 * @param {string} value
 * @param {string} [base]
 * @returns {URL | null}
 */
function parseHttpUrl(value, base) {
  try {
    const url = new URL(String(value || '').trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * An (possibly relative) link href resolved against the page it was found on,
 * as an absolute http(s) URL — or '' when it isn't one (javascript:, mailto:, …).
 * @param {string} href
 * @param {string} pageUrl
 */
function resolveLinkHref(href, pageUrl) {
  if (!String(href || '').trim()) return ''; // an element without an href is not a link
  const url = parseHttpUrl(href, pageUrl);
  return url ? url.href : '';
}

/**
 * @param {string} template
 * @param {string} currentUrl
 * @returns {PageTemplateProposal['example']}
 */
function exampleFor(template, currentUrl) {
  return template.split('{url}').join(currentUrl).split('{page}').join('2');
}

/**
 * @param {string} template
 * @param {'query' | 'path'} style
 * @param {string} currentUrl
 * @returns {PageTemplateProposal}
 */
function proposal(template, style, currentUrl) {
  return { template, style, usesStartUrl: template.includes('{url}'), example: exampleFor(template, currentUrl) };
}

/** @param {string} v */
const isInteger = (v) => /^\d+$/.test(v);

/**
 * The start URL itself with the page number replaced by {page} in the query.
 * Done on the original string (not through URLSearchParams) so the rest of
 * the URL keeps its exact encoding.
 * @param {URL} current
 * @param {string} key
 */
function replaceQueryNumber(current, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const search = current.search.replace(new RegExp(`([?&])${escaped}=\\d+(?=&|$)`), `$1${key}={page}`);
  return `${current.origin}${current.pathname}${search}`;
}

/**
 * Page number in the query of a "next"/"page 2" link: the one parameter that
 * is the next number (2 when the start URL has none, else its number + 1)
 * while everything else in the query stays the same.
 * @param {URL} current
 * @param {URL} link
 * @returns {PageTemplateProposal | null}
 */
function fromQueryLink(current, link) {
  if (current.hash) return null; // {url}?page=… would land after the fragment
  const candidates = [];
  for (const [key, value] of link.searchParams) {
    if (!isInteger(value)) continue;
    const currentValue = current.searchParams.get(key);
    // A parameter the start URL doesn't have yet must be a conventional page
    // name ("?cat=2" is a category, not page 2); one it already has just has
    // to be the next number.
    const next = currentValue === null
      ? value === '2' && PAGE_PARAM_NAMES.includes(key.toLowerCase())
      : isInteger(currentValue) && Number(value) === Number(currentValue) + 1;
    if (!next) continue;
    // Everything else must be identical, or this link is something else (a filter, a sort, …).
    /** @param {URLSearchParams} params */
    const others = (params) => [...params].filter(([k]) => k !== key).map(([k, v]) => `${k}=${v}`).sort().join('&');
    if (others(current.searchParams) !== others(link.searchParams)) continue;
    candidates.push(key);
  }
  const known = candidates.filter((key) => PAGE_PARAM_NAMES.includes(key.toLowerCase()));
  const key = known.length === 1 ? known[0] : candidates.length === 1 ? candidates[0] : null;
  // (several candidates and none conventional → ambiguous, no guess)
  if (!key) return null;
  if (current.searchParams.get(key) !== null) {
    return proposal(replaceQueryNumber(current, key), 'query', current.href);
  }
  const joiner = current.search ? '&' : '?';
  return proposal(`{url}${joiner}${key}={page}`, 'query', current.href);
}

/**
 * Page number in the path of a link: "/page/2/", "/seite/2".
 * @param {URL} current
 * @param {URL} link
 * @returns {PageTemplateProposal | null}
 */
function fromPathLink(current, link) {
  const linkMatch = PATH_SEGMENT_PATTERN.exec(link.pathname);
  if (!linkMatch || current.search !== link.search) return null;
  const word = linkMatch[1];
  const linkNumber = Number(linkMatch[2]);

  const currentMatch = PATH_SEGMENT_PATTERN.exec(current.pathname);
  if (currentMatch) {
    // The start URL already carries a page number: the link must be the next one.
    if (currentMatch[1].toLowerCase() !== word.toLowerCase() || Number(currentMatch[2]) + 1 !== linkNumber) return null;
    const path = current.pathname.replace(PATH_SEGMENT_PATTERN, `/${currentMatch[1]}/{page}`);
    return proposal(`${current.origin}${path}${current.search}`, 'path', current.href);
  }

  // No page number yet: the link is the start URL's path plus "page/2/".
  if (current.search || current.hash || linkNumber !== 2) return null;
  const base = current.pathname.endsWith('/') ? current.pathname : `${current.pathname}/`;
  const rest = link.pathname.startsWith(base) ? link.pathname.slice(base.length) : null;
  if (rest === null || !new RegExp(`^${word}/2/?$`, 'i').test(rest)) return null;
  const startsWithSlash = current.pathname.endsWith('/') ? '' : '/';
  return proposal(`{url}${startsWithSlash}${word}/{page}${rest.endsWith('/') ? '/' : ''}`, 'path', current.href);
}

/**
 * Looks only at the start URL: a page-1 URL that already says so
 * ("?page=1", "/page/1/"). The number is replaced by {page}, no {url} —
 * the start URL stays page 1 and the template builds pages 2, 3, ….
 * @param {URL} current
 * @returns {PageTemplateProposal | null}
 */
function fromCurrentUrl(current) {
  const keys = [...current.searchParams]
    .filter(([key, value]) => PAGE_PARAM_NAMES.includes(key.toLowerCase()) && value === '1')
    .map(([key]) => key);
  if (keys.length === 1) return proposal(replaceQueryNumber(current, keys[0]), 'query', current.href);
  if (keys.length > 1) return null;

  const match = PATH_SEGMENT_PATTERN.exec(current.pathname);
  if (match && match[2] === '1') {
    const path = current.pathname.replace(PATH_SEGMENT_PATTERN, `/${match[1]}/{page}`);
    return proposal(`${current.origin}${path}${current.search}`, 'path', current.href);
  }
  return null;
}

/**
 * Proposes a page-number URL template.
 *
 * With `linkHref` (the href of a clicked "next" / "page 2" link) the pattern is
 * learned from how that link differs from the start URL; without one (or when
 * the link shows nothing recognisable) only a start URL that already carries
 * page 1 is recognised.
 * @param {{ currentUrl: string, linkHref?: string | null }} input
 * @returns {PageTemplateProposal | null}
 */
function detectPageTemplate({ currentUrl, linkHref }) {
  const current = parseHttpUrl(currentUrl);
  if (!current) return null;
  const link = linkHref ? parseHttpUrl(linkHref, current.href) : null;
  if (link && link.origin === current.origin) {
    const found = (link.pathname === current.pathname ? fromQueryLink(current, link) : null) || fromPathLink(current, link);
    if (found) return found;
  }
  return fromCurrentUrl(current);
}

/**
 * Whether the pagination draft already holds exactly this proposal — the
 * suggestion banner stays out of the way then.
 * @param {{ enabled?: boolean, kind?: string, urlTemplate?: string } | null | undefined} pagination
 * @param {PageTemplateProposal | null} found
 */
function proposalAlreadyApplied(pagination, found) {
  return Boolean(found && pagination?.enabled && pagination.kind === 'pageNumber' && (pagination.urlTemplate || '').trim() === found.template);
}

module.exports = {
  PAGE_PARAM_NAMES, PAGE_PATH_WORDS, detectPageTemplate, resolveLinkHref, proposalAlreadyApplied,
};
