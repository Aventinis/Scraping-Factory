// Issue #224: pure draft/wire logic for API mode's cursor/token pagination.
const {
  createDefaultCursorDraft, cursorDraftIsComplete, buildApiCursorPagination, detectCursorSuggestion,
  isValidQueryParameterName, isValidBodyPath,
} = require('./api-cursor-pagination');

describe('cursorDraftIsComplete', () => {
  const query = (patch = {}) => ({ ...createDefaultCursorDraft(), nextCursorPath: 'next', queryParameterName: 'cursor', ...patch });

  test('no draft (feature off) never blocks Apply', () => {
    expect(cursorDraftIsComplete(null)).toBe(true);
  });

  test('a fresh default draft is incomplete until a path and a target name are given', () => {
    expect(cursorDraftIsComplete(createDefaultCursorDraft())).toBe(false);
    expect(cursorDraftIsComplete(query())).toBe(true);
  });

  test('rejects an unusable query parameter name and a non-positive page cap', () => {
    expect(cursorDraftIsComplete(query({ queryParameterName: 'a b' }))).toBe(false);
    expect(cursorDraftIsComplete(query({ queryParameterName: 'a=b' }))).toBe(false);
    expect(cursorDraftIsComplete(query({ maxPages: 0 }))).toBe(false);
  });

  test('a body target needs a POST request with a body tree and a plain dot path', () => {
    const body = query({ target: 'Body', bodyPath: 'variables.after' });
    expect(cursorDraftIsComplete(body, { method: 'POST', hasBodyTree: true })).toBe(true);
    expect(cursorDraftIsComplete(body, { method: 'GET', hasBodyTree: true })).toBe(false);
    expect(cursorDraftIsComplete(body, { method: 'POST', hasBodyTree: false })).toBe(false);
    expect(cursorDraftIsComplete({ ...body, bodyPath: 'a[0].b' }, { method: 'POST', hasBodyTree: true })).toBe(false);
    expect(cursorDraftIsComplete({ ...body, bodyPath: 'a..b' }, { method: 'POST', hasBodyTree: true })).toBe(false);
  });

  test('name/path validators', () => {
    expect(isValidQueryParameterName('page_token')).toBe(true);
    expect(isValidQueryParameterName('')).toBe(false);
    expect(isValidBodyPath('variables.after')).toBe(true);
    expect(isValidBodyPath('')).toBe(false);
  });
});

describe('buildApiCursorPagination', () => {
  test('null draft → null', () => {
    expect(buildApiCursorPagination(null)).toBeNull();
  });

  test('query target sends only the query parameter name, omitting a blank hasNextPagePath', () => {
    const wire = buildApiCursorPagination({
      ...createDefaultCursorDraft(), nextCursorPath: ' next ', queryParameterName: ' cursor ', bodyPath: 'ignored',
    });
    expect(wire).toEqual({ nextCursorPath: 'next', target: 'Query', queryParameterName: 'cursor', maxPages: 50 });
  });

  test('body target sends only the body path, plus hasNextPagePath when set', () => {
    const wire = buildApiCursorPagination({
      ...createDefaultCursorDraft(), nextCursorPath: 'pageInfo.endCursor', hasNextPagePath: 'pageInfo.hasNextPage',
      target: 'Body', bodyPath: 'variables.after', queryParameterName: 'ignored', maxPages: 7,
    });
    expect(wire).toEqual({
      nextCursorPath: 'pageInfo.endCursor', hasNextPagePath: 'pageInfo.hasNextPage', target: 'Body', bodyPath: 'variables.after', maxPages: 7,
    });
  });
});

describe('detectCursorSuggestion', () => {
  test('finds a Relay-style cursor, has-next flag and body slot', () => {
    const found = detectCursorSuggestion({
      url: 'https://example.com/graphql', method: 'POST',
      body: JSON.stringify({ data: { items: { edges: [{ cursor: 'per-item' }], pageInfo: { endCursor: 'abc', hasNextPage: true } } } }),
      requestBody: JSON.stringify({ query: '{ items }', variables: { first: 10, after: null } }),
    });
    expect(found).toEqual({
      nextCursorPath: 'data.items.pageInfo.endCursor', hasNextPagePath: 'data.items.pageInfo.hasNextPage',
      target: 'Body', queryParameterName: '', bodyPath: 'variables.after',
    });
  });

  test('never suggests a per-item cursor inside an array', () => {
    const found = detectCursorSuggestion({ url: 'https://example.com/a', method: 'GET', body: JSON.stringify({ edges: [{ cursor: 'x' }] }) });
    expect(found.nextCursorPath).toBe('');
  });

  test('finds a REST next_page_token and the query parameter of the recorded request', () => {
    const found = detectCursorSuggestion({
      url: 'https://example.com/api/items?limit=20&page_token=zzz', method: 'GET',
      body: JSON.stringify({ items: [], next_page_token: 'abc' }),
    });
    expect(found).toMatchObject({ nextCursorPath: 'next_page_token', target: 'Query', queryParameterName: 'page_token' });
  });

  test('prefers a specific cursor key over a bare "next"', () => {
    const found = detectCursorSuggestion({
      url: 'https://example.com/a', method: 'GET', body: JSON.stringify({ next: 'x', meta: { nextCursor: 'y' } }),
    });
    expect(found.nextCursorPath).toBe('meta.nextCursor');
  });

  test('copes with a non-JSON response and an unparsable url', () => {
    expect(detectCursorSuggestion({ url: 'not a url', method: 'GET', body: '<html>' })).toEqual({
      nextCursorPath: '', hasNextPagePath: '', target: 'Query', queryParameterName: '', bodyPath: '',
    });
  });
});
