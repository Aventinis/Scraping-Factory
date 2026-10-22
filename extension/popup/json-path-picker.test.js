// Issue #404: the JSON-path picker's tree model and path derivation.
const {
  jsonTypeOf, isAddressableKey, resolveJsonPath, buildJsonPathTree, selectablePaths,
  parseEntryJson, findSourceEntry, jsonResponseEntries, DEFAULT_MAX_NODES,
} = require('./json-path-picker');
const { isValidBodyPath } = require('./api-cursor-pagination');
const { resolveApiGroupScopePath } = require('./api-config');

const RESPONSE = {
  pageInfo: { endCursor: 'abc', hasNextPage: true },
  meta: { generatedAt: '2026-08-28' },
  access_token: 'tok-123',
  categories: [
    { id: 'a', name: 'Alpha', subcategories: [{ id: 'a1', products: [{ sku: 1, title: 'X' }] }] },
    { id: 'b', name: 'Beta', subcategories: [] },
  ],
  'odd.key': 1,
  'odd[key]': 2,
};

const find = (nodes, path) => {
  for (const node of nodes) {
    if (node.path === path) return node;
    const inner = node.children && find(node.children, path);
    if (inner) return inner;
  }
  return null;
};

describe('path syntax round trip', () => {
  test('every path the picker produces resolves back to the value it was made from (leaf mode)', () => {
    const { nodes } = buildJsonPathTree(RESPONSE, { mode: 'leaf' });
    const paths = selectablePaths(nodes);
    expect(paths).toContain('pageInfo.endCursor');
    expect(paths).toContain('categories[0].subcategories[0].products[0].title');
    for (const path of paths) expect(resolveJsonPath(RESPONSE, path)).not.toBeUndefined();
    expect(resolveJsonPath(RESPONSE, 'pageInfo.endCursor')).toBe('abc');
    expect(resolveJsonPath(RESPONSE, 'categories[0].name')).toBe('Alpha');
  });

  test('resolveJsonPath: empty path is the root, misses are undefined', () => {
    expect(resolveJsonPath(RESPONSE, '')).toBe(RESPONSE);
    expect(resolveJsonPath(RESPONSE, 'pageInfo.nope')).toBeUndefined();
    expect(resolveJsonPath(RESPONSE, 'categories[5]')).toBeUndefined();
    expect(resolveJsonPath(RESPONSE, 'pageInfo[0]')).toBeUndefined();
    expect(resolveJsonPath(RESPONSE, 'categories[*]')).toBeUndefined();
  });
});

describe('leaf mode (cursor, flag, token)', () => {
  const tree = buildJsonPathTree(RESPONSE, { mode: 'leaf' });

  test('scalars are selectable, objects and arrays only expand', () => {
    expect(find(tree.nodes, 'pageInfo.endCursor')).toMatchObject({ type: 'string', selectable: true, preview: '"abc"' });
    expect(find(tree.nodes, 'pageInfo.hasNextPage')).toMatchObject({ type: 'boolean', selectable: true });
    expect(find(tree.nodes, 'pageInfo')).toMatchObject({ type: 'object', selectable: false });
    expect(find(tree.nodes, 'categories')).toMatchObject({ type: 'array', selectable: false, itemCount: 2 });
  });

  test('an array is shown through its first element only', () => {
    expect(find(tree.nodes, 'categories[0]')).toBeTruthy();
    expect(find(tree.nodes, 'categories[1]')).toBeNull();
    expect(find(tree.nodes, 'categories[0].subcategories[0].id')).toMatchObject({ preview: '"a1"' });
  });

  test('a key the script cannot address is shown but not selectable', () => {
    expect(find(tree.nodes, 'odd.key')).toMatchObject({ selectable: false, reason: 'badKey' });
    expect(find(tree.nodes, 'odd[key]')).toMatchObject({ selectable: false, reason: 'badKey' });
    expect(isAddressableKey('a b')).toBe(true);
    expect(isAddressableKey('a.b')).toBe(false);
    expect(isAddressableKey('')).toBe(false);
  });

  test('a top-level array is entered through its first element; an empty array offers nothing', () => {
    expect(selectablePaths(buildJsonPathTree([{ id: 1 }], { mode: 'leaf' }).nodes)).toEqual(['[0].id']);
    expect(buildJsonPathTree([], { mode: 'leaf' }).nodes).toEqual([]);
    expect(buildJsonPathTree('text', { mode: 'leaf' }).nodes).toEqual([]);
  });

  test('null values and numbers are selectable', () => {
    const { nodes } = buildJsonPathTree({ after: null, n: 3, ok: false }, { mode: 'leaf' });
    expect(selectablePaths(nodes)).toEqual(['after', 'n', 'ok']);
  });
});

describe('body mode (cursor slot in the request body)', () => {
  const body = { query: 'q', variables: { first: 20, after: null, filter: { tags: ['a'] } } };
  const tree = buildJsonPathTree(body, { mode: 'body' });

  test('produces dot paths with no bracket, valid for the companion', () => {
    const paths = selectablePaths(tree.nodes);
    expect(paths).toContain('variables.after');
    for (const path of paths) expect(isValidBodyPath(path)).toBe(true);
  });

  test('arrays are not entered and say why', () => {
    expect(find(tree.nodes, 'variables.filter.tags')).toMatchObject({ type: 'array', selectable: false, reason: 'bodyNoArrays' });
    expect(find(tree.nodes, 'variables.filter.tags[0]')).toBeNull();
  });
});

describe('group mode (a group path relative to the parent scope)', () => {
  test('root level: objects and arrays are selectable, scalars are not', () => {
    const { nodes } = buildJsonPathTree(RESPONSE, { mode: 'group' });
    const paths = selectablePaths(nodes);
    expect(paths).toContain('categories');
    expect(paths).toContain('pageInfo');
    expect(paths).not.toContain('pageInfo.endCursor');
    expect(find(nodes, 'access_token')).toMatchObject({ selectable: false });
  });

  test('arrays are terminal: nothing below an item is offered', () => {
    const { nodes } = buildJsonPathTree(RESPONSE, { mode: 'group' });
    expect(find(nodes, 'categories')).toMatchObject({ itemCount: 2 });
    expect(find(nodes, 'categories')?.children).toBeUndefined();
  });

  test('rooted at a scope: the tree starts at the first instance and paths are relative to it', () => {
    const { nodes, scopeFound } = buildJsonPathTree(RESPONSE, { mode: 'group', scopePath: 'categories[0]' });
    expect(scopeFound).toBe(true);
    expect(selectablePaths(nodes)).toEqual(['subcategories']);
    // …and that is exactly what the existing scope derivation points at
    const groups = [{ kind: 'group', name: 'Kategorie', path: 'categories', children: [] }];
    expect(resolveApiGroupScopePath(groups, [0])).toBe('categories[0]');
  });

  test('a nested scope two levels down', () => {
    const scope = 'categories[0].subcategories[0]';
    expect(selectablePaths(buildJsonPathTree(RESPONSE, { mode: 'group', scopePath: scope }).nodes)).toEqual(['products']);
  });

  test('a scope that is not in this JSON is reported, not guessed', () => {
    expect(buildJsonPathTree(RESPONSE, { mode: 'group', scopePath: 'categories[7]' })).toEqual({ nodes: [], truncated: false, scopeFound: false });
  });
});

describe('size limit', () => {
  test('a huge object is cut at maxNodes and says so', () => {
    const big = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k${i}`, i]));
    const { nodes, truncated } = buildJsonPathTree(big, { mode: 'leaf' });
    expect(truncated).toBe(true);
    expect(nodes.length).toBe(DEFAULT_MAX_NODES);
    expect(buildJsonPathTree(big, { mode: 'leaf', maxNodes: 5 }).nodes).toHaveLength(5);
  });

  test('a small one is not flagged', () => {
    expect(buildJsonPathTree({ a: 1 }, { mode: 'leaf' }).truncated).toBe(false);
  });
});

describe('previews', () => {
  test('long strings are shortened, containers show their size', () => {
    const { nodes } = buildJsonPathTree({ s: 'x'.repeat(100), o: { a: 1, b: 2 }, l: [1, 2, 3] }, { mode: 'leaf' });
    expect(find(nodes, 's').preview.length).toBeLessThanOrEqual(40);
    expect(find(nodes, 's').preview.endsWith('…')).toBe(true);
    expect(find(nodes, 'o').preview).toBe('{ 2 }');
    expect(find(nodes, 'l').preview).toBe('[ 3 ]');
  });

  test('jsonTypeOf', () => {
    expect([null, undefined, [], {}, 'a', 1, true].map(jsonTypeOf)).toEqual(['null', 'null', 'array', 'object', 'string', 'number', 'boolean']);
  });
});

describe('finding the recorded JSON', () => {
  const entries = [
    { id: 1, url: 'https://a.example/api/items', method: 'GET', status: 200, body: '{"items":[1]}', requestBody: '' },
    { id: 2, url: 'https://a.example/api/items', method: 'GET', status: 200, body: '{"items":[2]}', requestBody: '' },
    { id: 3, url: 'https://a.example/graphql', method: 'POST', status: 200, body: '{"data":{}}', requestBody: '{"variables":{"after":null}}' },
    { id: 4, url: 'https://a.example/big', method: 'GET', status: 200, body: '{"cut', bodyTruncated: true },
    { id: 5, url: 'https://a.example/html', method: 'GET', status: 200, body: '<html>' },
    { id: 6, url: 'https://a.example/err', method: 'GET', status: 500, body: '{"error":1}' },
  ];

  test('findSourceEntry: by id, else the latest with the same URL and method', () => {
    expect(findSourceEntry(entries, { sourceEntryId: 1, sourceUrl: 'x' })?.id).toBe(1);
    expect(findSourceEntry(entries, { sourceUrl: 'https://a.example/api/items', method: 'GET' })?.id).toBe(2);
    expect(findSourceEntry(entries, { sourceUrl: 'https://a.example/graphql', method: 'GET' })).toBeNull(); // wrong method
    expect(findSourceEntry(entries, { sourceUrl: 'https://nowhere.example/' })).toBeNull();
  });

  test('parseEntryJson says why a body cannot be offered', () => {
    expect(parseEntryJson(entries[0], 'response')).toEqual({ json: { items: [1] }, reason: '' });
    expect(parseEntryJson(entries[2], 'request').json).toEqual({ variables: { after: null } });
    expect(parseEntryJson(entries[3], 'response').reason).toBe('truncated');
    expect(parseEntryJson(entries[4], 'response').reason).toBe('notJson');
    expect(parseEntryJson(entries[0], 'request').reason).toBe('noBody'); // recorded, but no request body
    expect(parseEntryJson({ method: 'POST', requestBodySkipped: true }, 'request').reason).toBe('skipped');
    expect(parseEntryJson(null, 'response').reason).toBe('noEntry');
    expect(parseEntryJson({ body: '42' }, 'response').reason).toBe('notJson'); // a bare scalar has nothing to pick
  });

  test('jsonResponseEntries keeps successful, parseable JSON and puts the preferred URL first', () => {
    expect(jsonResponseEntries(entries).map((e) => e.id)).toEqual([1, 2, 3]);
    expect(jsonResponseEntries(entries, { preferUrl: 'https://a.example/graphql', preferMethod: 'POST' }).map((e) => e.id)).toEqual([3, 1, 2]);
  });
});
