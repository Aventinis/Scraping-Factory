// Issue #217: pure-function coverage for earlierParameterNames — the rest of
// api-config.js's own pure helpers have historically been covered indirectly
// via popup.test.js's/session-restore.test.js's integration tests rather
// than a dedicated file, but this is a genuinely new, independently
// testable function, so it gets its own <feature>.test.js per Architecture
// Decision #12.
const { earlierParameterNames } = require('./api-config');

/** @param {Array} pathSegments */
function draftWith(pathSegments, queryParams = [], bodyParameters = []) {
  return {
    urlParts: { origin: 'https://example.com', pathSegments, queryParams },
    bodyParameters,
  };
}

describe('earlierParameterNames', () => {
  test('returns every named variable part declared before the given one, in declaration order', () => {
    const draft = draftWith([
      { value: 'milch', variable: true, name: 'category' },
      { value: '1', variable: true, name: 'week' },
    ]);
    expect(earlierParameterNames(draft, 'path:1')).toEqual(['category']);
    expect(earlierParameterNames(draft, 'path:0')).toEqual([]);
  });

  test('includes query params declared after path segments, and body parameters last', () => {
    const draft = draftWith(
      [{ value: 'a', variable: true, name: 'category' }],
      [{ key: 'sort', value: 'x', variable: true, name: 'sort' }],
      [{ id: 'body:1', name: 'token' }],
    );
    expect(earlierParameterNames(draft, 'body:1')).toEqual(['category', 'sort']);
  });

  test('skips a part with no name typed yet', () => {
    const draft = draftWith([
      { value: 'a', variable: true, name: '' },
      { value: 'b', variable: true, name: 'week' },
    ]);
    expect(earlierParameterNames(draft, 'path:1')).toEqual([]);
  });

  test('returns an empty list for an unknown partId', () => {
    const draft = draftWith([{ value: 'a', variable: true, name: 'category' }]);
    expect(earlierParameterNames(draft, 'path:99')).toEqual([]);
  });

  test('a fixed (non-variable) part is never counted, even though it still occupies an index', () => {
    const draft = draftWith([
      { value: 'fixed', variable: false, name: '' },
      { value: 'a', variable: true, name: 'category' },
      { value: 'b', variable: true, name: 'week' },
    ]);
    expect(earlierParameterNames(draft, 'path:2')).toEqual(['category']);
  });
});
