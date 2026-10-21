// Issue #321: pure draft/wire logic for API mode's Link-header pagination.
const { createDefaultLinkDraft, linkDraftIsComplete, buildApiLinkHeaderPagination } = require('./api-link-pagination');
const { buildApiConfig } = require('./api-config');

describe('linkDraftIsComplete', () => {
  test('no draft (feature off) never blocks Apply', () => {
    expect(linkDraftIsComplete(null)).toBe(true);
  });

  test('a default draft is complete for a plain GET request', () => {
    expect(linkDraftIsComplete(createDefaultLinkDraft(), { method: 'GET' })).toBe(true);
    expect(linkDraftIsComplete(createDefaultLinkDraft())).toBe(true);
  });

  test('needs a positive integer page cap', () => {
    expect(linkDraftIsComplete({ maxPages: 0 })).toBe(false);
    expect(linkDraftIsComplete({ maxPages: 2.5 })).toBe(false);
  });

  test.each([
    ['a POST request', { method: 'POST' }],
    ['an embedded JSON source', { embeddedJsonSource: { scriptSelector: '#d' } }],
    ['cursor pagination', { cursorPagination: { nextCursorPath: 'n' } }],
  ])('is not valid together with %s (the companion rejects it too)', (_, context) => {
    expect(linkDraftIsComplete(createDefaultLinkDraft(), context)).toBe(false);
  });
});

describe('buildApiLinkHeaderPagination / buildApiConfig', () => {
  test('draft → wire shape; null stays null', () => {
    expect(buildApiLinkHeaderPagination(null)).toBeNull();
    expect(buildApiLinkHeaderPagination({ maxPages: 9 })).toEqual({ maxPages: 9 });
  });

  const base = {
    urlParts: { origin: 'https://example.com', pathSegments: [{ id: 's0', value: 'items', variable: false }], queryParams: [] },
    itemsPath: 'items', fields: [{ name: 'T', path: 't' }], parameterSources: {}, capturedHeaders: [], headerDecisions: {},
  };

  test('buildApiConfig sends linkHeaderPagination only when set', () => {
    expect(buildApiConfig({ ...base, linkHeaderPagination: { maxPages: 3 } }).linkHeaderPagination).toEqual({ maxPages: 3 });
    expect(buildApiConfig(base)).not.toHaveProperty('linkHeaderPagination');
  });
});
