// Issue #405: page-number template derivation across common URL shapes, and the
// proposal surviving buildPaginationConfig unchanged.
const { detectPageTemplate, resolveLinkHref, proposalAlreadyApplied } = require('./pagination-template');
const { buildPaginationConfig } = require('./scraping-config-builder');

const detect = (currentUrl, linkHref) => detectPageTemplate({ currentUrl, linkHref });

describe('from a clicked "next" / "page 2" link — query style', () => {
  test.each([
    ['https://shop.example/list', 'https://shop.example/list?page=2', '{url}?page={page}'],
    ['https://shop.example/list', '/list?page=2', '{url}?page={page}'],
    ['https://shop.example/list?cat=7', 'https://shop.example/list?cat=7&page=2', '{url}&page={page}'],
    ['https://shop.example/list', 'https://shop.example/list?p=2', '{url}?p={page}'],
    ['https://shop.example/list', 'https://shop.example/list?seite=2', '{url}?seite={page}'],
    ['https://shop.example/list?page=1', 'https://shop.example/list?page=2', 'https://shop.example/list?page={page}'],
    ['https://shop.example/list?cat=7&page=1&sort=new', 'https://shop.example/list?cat=7&page=2&sort=new', 'https://shop.example/list?cat=7&page={page}&sort=new'],
  ])('%s + %s → %s', (current, link, template) => {
    const found = detect(current, link);
    expect(found?.template).toBe(template);
    expect(found?.style).toBe('query');
  });

  test('a parameter the start URL does not have yet must be a conventional page name', () => {
    expect(detect('https://a.example/x', 'https://a.example/x?start=2')).toBeNull();
    // …but one it already has only has to be the next number
    expect(detect('https://a.example/x?start=1', 'https://a.example/x?start=2')?.template).toBe('https://a.example/x?start={page}');
  });

  test('a known page parameter wins over another numeric one that also changed', () => {
    expect(detect('https://a.example/x?n=1', 'https://a.example/x?n=2&page=2')).toBeNull(); // others differ → not a pager link
  });

  test.each([
    ['a filter link', 'https://shop.example/list', 'https://shop.example/list?cat=2'],
    ['a different page', 'https://shop.example/list', 'https://shop.example/other?page=2'],
    ['page 3 from a plain start', 'https://shop.example/list', 'https://shop.example/list?page=3'],
    ['another host', 'https://shop.example/list', 'https://elsewhere.example/list?page=2'],
    ['a mailto link', 'https://shop.example/list', 'mailto:me@example.com'],
    ['a fragment start URL', 'https://shop.example/list#top', 'https://shop.example/list?page=2'],
  ])('no proposal for %s', (_name, current, link) => {
    expect(detect(current, link)).toBeNull();
  });
});

describe('from a clicked link — path style', () => {
  test.each([
    ['https://blog.example/posts/', 'https://blog.example/posts/page/2/', '{url}page/{page}/'],
    ['https://blog.example/posts', 'https://blog.example/posts/page/2', '{url}/page/{page}'],
    ['https://blog.example/posts/', 'https://blog.example/posts/seite/2/', '{url}seite/{page}/'],
    ['https://blog.example/posts/page/1/', 'https://blog.example/posts/page/2/', 'https://blog.example/posts/page/{page}/'],
  ])('%s + %s → %s', (current, link, template) => {
    const found = detect(current, link);
    expect(found?.template).toBe(template);
    expect(found?.style).toBe('path');
  });

  test('a link that is not the next page is not turned into a template', () => {
    expect(detect('https://blog.example/posts/', 'https://blog.example/posts/page/3/')).toBeNull();
    // a page-1 start URL still says so by itself, whatever the link was
    expect(detect('https://blog.example/posts/page/1/', 'https://blog.example/posts/page/3/')).toEqual(detect('https://blog.example/posts/page/1/'));
  });
});

describe('from the start URL alone', () => {
  test.each([
    ['https://shop.example/list?page=1', 'https://shop.example/list?page={page}'],
    ['https://shop.example/list?cat=7&p=1', 'https://shop.example/list?cat=7&p={page}'],
    ['https://shop.example/list?PAGE=1', 'https://shop.example/list?PAGE={page}'],
    ['https://blog.example/posts/page/1/', 'https://blog.example/posts/page/{page}/'],
  ])('%s → %s', (current, template) => {
    expect(detect(current)?.template).toBe(template);
  });

  test.each([
    'https://shop.example/list',
    'https://shop.example/list?page=2', // a later page: pages 2.. would be wrong
    'https://shop.example/list?page=0', // zero-based
    'https://shop.example/list?page=1&p=1', // two candidates
    'https://shop.example/list?offset=0',
    'not a url',
    '',
  ])('nothing for %s', (current) => {
    expect(detect(current)).toBeNull();
  });
});

describe('the example and the round trip', () => {
  test('the example is what page 2 would be requested as', () => {
    expect(detect('https://shop.example/list', '/list?page=2')?.example).toBe('https://shop.example/list?page=2');
    expect(detect('https://shop.example/list?page=1')?.example).toBe('https://shop.example/list?page=2');
    expect(detect('https://blog.example/posts/', '/posts/page/2/')?.example).toBe('https://blog.example/posts/page/2/');
  });

  test('usesStartUrl says whether {url} is part of the template', () => {
    expect(detect('https://shop.example/list', '/list?page=2')?.usesStartUrl).toBe(true);
    expect(detect('https://shop.example/list?page=1')?.usesStartUrl).toBe(false);
  });

  test.each([
    ['https://shop.example/list', '/list?page=2'],
    ['https://shop.example/list?page=1', null],
    ['https://blog.example/posts/', '/posts/page/2/'],
    ['https://blog.example/posts/page/1/', null],
  ])('%s: the proposed template is sent unchanged by buildPaginationConfig', (current, link) => {
    const found = detect(current, link);
    const wire = buildPaginationConfig({ enabled: true, kind: 'pageNumber', nextLinkSelector: '', urlTemplate: found.template, maxPages: 3 });
    expect(wire).toEqual({ kind: 'pageNumber', urlTemplate: found.template, maxPages: 3 });
  });
});

describe('helpers', () => {
  test('resolveLinkHref makes a link absolute and drops non-http ones', () => {
    expect(resolveLinkHref('?page=2', 'https://a.example/list')).toBe('https://a.example/list?page=2');
    expect(resolveLinkHref('/x/2', 'https://a.example/list')).toBe('https://a.example/x/2');
    expect(resolveLinkHref('javascript:void(0)', 'https://a.example/list')).toBe('');
    expect(resolveLinkHref('', 'https://a.example/list')).toBe('https://a.example/list');
  });

  test('proposalAlreadyApplied only when the same template is active as a page-number pagination', () => {
    const found = detect('https://shop.example/list', '/list?page=2');
    const on = { enabled: true, kind: 'pageNumber', urlTemplate: ` ${found.template} ` };
    expect(proposalAlreadyApplied(on, found)).toBe(true);
    expect(proposalAlreadyApplied({ ...on, kind: 'nextLink' }, found)).toBe(false);
    expect(proposalAlreadyApplied({ ...on, enabled: false }, found)).toBe(false);
    expect(proposalAlreadyApplied({ ...on, urlTemplate: 'x' }, found)).toBe(false);
    expect(proposalAlreadyApplied(on, null)).toBe(false);
  });
});
