// Page-number template derivation: pure, no DOM (pagination-ui.js renders it). The "Page-number URL" kind needs a template with
// {page} (and optionally {url}); this proposes one from the tracked page's URL and, when the user clicked one, the href of a
// "next" / "page 2" link. Only ever a proposal, never applied by itself, and conservative: anything ambiguous (zero-based
// counters, offsets, several plausible parameters, a #fragment) returns null. {page} counts from 2 in the script, so page 2 must
// be the second page.

export interface PageTemplateProposal {
  /** The URL template, with {page} (and {url} when it appends to the start URL). */
  template: string;
  style: 'query' | 'path';
  /** Whether the template contains {url}. */
  usesStartUrl: boolean;
  /** What page 2 would be requested as. */
  example: string;
}

// Query parameter names that, by convention, carry a page number.
export const PAGE_PARAM_NAMES = ['page', 'p', 'pg', 'paged', 'pagenum', 'pagenumber', 'pageno', 'seite', 'pagina', 'currentpage'];
// Path words ("/page/2/", "/seite/2") that carry one.
export const PAGE_PATH_WORDS = ['page', 'seite', 'pagina', 'p'];

const PATH_SEGMENT_PATTERN = new RegExp(`/(${PAGE_PATH_WORDS.join('|')})/(\\d+)(?=/|$)`, 'i');

function parseHttpUrl(value: string, base?: string): URL | null {
  try {
    const url = new URL(String(value || '').trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** A (possibly relative) link href resolved against the page it was found on, as an absolute http(s) URL; '' when it is none (javascript:, mailto:, ...). */
export function resolveLinkHref(href: string, pageUrl: string): string {
  if (!String(href || '').trim()) return ''; // an element without an href is not a link
  const url = parseHttpUrl(href, pageUrl);
  return url ? url.href : '';
}

function exampleFor(template: string, currentUrl: string): string {
  return template.split('{url}').join(currentUrl).split('{page}').join('2');
}

function proposal(template: string, style: 'query' | 'path', currentUrl: string): PageTemplateProposal {
  return { template, style, usesStartUrl: template.includes('{url}'), example: exampleFor(template, currentUrl) };
}

const isInteger = (v: string) => /^\d+$/.test(v);

/**
 * The start URL itself with the page number replaced by {page} in the query. Done on the original string (not through
 * URLSearchParams) so the rest of the URL keeps its exact encoding.
 */
function replaceQueryNumber(current: URL, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const search = current.search.replace(new RegExp(`([?&])${escaped}=\\d+(?=&|$)`), `$1${key}={page}`);
  return `${current.origin}${current.pathname}${search}`;
}

/**
 * Page number in the query of a "next"/"page 2" link: the one parameter that is the next number (2 when the start URL has none,
 * else its number + 1) while everything else in the query stays the same.
 */
function fromQueryLink(current: URL, link: URL): PageTemplateProposal | null {
  if (current.hash) return null; // {url}?page=… would land after the fragment
  const candidates: string[] = [];
  for (const [key, value] of link.searchParams) {
    if (!isInteger(value)) continue;
    const currentValue = current.searchParams.get(key);
    // A parameter the start URL doesn't have yet must be a conventional page name ("?cat=2" is a category, not page 2); one it
    // already has just has to be the next number.
    const next = currentValue === null
      ? value === '2' && PAGE_PARAM_NAMES.includes(key.toLowerCase())
      : isInteger(currentValue) && Number(value) === Number(currentValue) + 1;
    if (!next) continue;
    // Everything else must be identical, or this link is something else (a filter, a sort, …).
    const others = (params: URLSearchParams) => [...params].filter(([k]) => k !== key).map(([k, v]) => `${k}=${v}`).sort().join('&');
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

/** Page number in the path of a link: "/page/2/", "/seite/2". */
function fromPathLink(current: URL, link: URL): PageTemplateProposal | null {
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
 * Looks only at the start URL: a page-1 URL that already says so ("?page=1", "/page/1/"). The number is replaced by {page}, no
 * {url}: the start URL stays page 1 and the template builds pages 2, 3, ….
 */
function fromCurrentUrl(current: URL): PageTemplateProposal | null {
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
 * Proposes a page-number URL template. With `linkHref` (the href of a clicked "next" / "page 2" link) the pattern is learned from how
 * that link differs from the start URL; without one (or when the link shows nothing recognisable) only a start URL that already
 * carries page 1 is recognised.
 */
export function detectPageTemplate({ currentUrl, linkHref }: { currentUrl: string; linkHref?: string | null }): PageTemplateProposal | null {
  const current = parseHttpUrl(currentUrl);
  if (!current) return null;
  const link = linkHref ? parseHttpUrl(linkHref, current.href) : null;
  if (link && link.origin === current.origin) {
    const found = (link.pathname === current.pathname ? fromQueryLink(current, link) : null) || fromPathLink(current, link);
    if (found) return found;
  }
  return fromCurrentUrl(current);
}

/** Whether the pagination draft already holds exactly this proposal; the suggestion banner stays out of the way then. */
export function proposalAlreadyApplied(
  pagination: { enabled?: boolean; kind?: string; urlTemplate?: string } | null | undefined, found: PageTemplateProposal | null,
): boolean {
  return Boolean(found && pagination?.enabled && pagination.kind === 'pageNumber' && (pagination.urlTemplate || '').trim() === found.template);
}
