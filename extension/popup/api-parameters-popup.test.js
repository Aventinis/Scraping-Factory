require('./test-support/popup-env');
const {
  parseUrlTemplateParts,
  buildUrlTemplate,
  parseValueListInput,
  buildStaticListSource,
  buildDiscoverySource,
  buildRangeSource,
  buildBrowserDiscoverySource,
  buildApiHeaders,
  buildApiConfig,
  findUrlTemplateMatches,
  mergeValueListValues,
  variableUrlParts,
  apiConfigDraftHasAllSourcesChosen,
  detectRangeFormat,
  findUrlPartValue,
  rangeFormatExample,
  jsonValueToBodyDraft,
  resolveBodyTreeNode,
  updateBodyTreeNode,
  bodyTreeReferencesParameterId,
  bodyTreeLeavesAreBound,
  serializeBodyTree,
  allParameterParts,
} = require('./popup');

describe('parseUrlTemplateParts / buildUrlTemplate (Issue #53 Phase 5)', () => {
  test('splits origin, path segments and query params', () => {
    const parts = parseUrlTemplateParts('https://example.com/api/items/42?category=Elektronik&page=1');

    expect(parts.origin).toBe('https://example.com');
    expect(parts.pathSegments).toEqual([
      { value: 'api', variable: false, name: '' },
      { value: 'items', variable: false, name: '' },
      { value: '42', variable: false, name: '' },
    ]);
    expect(parts.queryParams).toEqual([
      { key: 'category', value: 'Elektronik', variable: false, name: 'category' },
      { key: 'page', value: '1', variable: false, name: 'page' },
    ]);
  });

  test('ignores a leading/trailing slash (no empty segments)', () => {
    expect(parseUrlTemplateParts('https://example.com/api/').pathSegments).toEqual([{ value: 'api', variable: false, name: '' }]);
  });

  test('a URL with no query string has no query params', () => {
    expect(parseUrlTemplateParts('https://example.com/api').queryParams).toEqual([]);
  });

  test('buildUrlTemplate round-trips an all-literal decomposition back to the original URL', () => {
    const parts = parseUrlTemplateParts('https://example.com/api/items?category=Elektronik');
    expect(buildUrlTemplate(parts)).toBe('https://example.com/api/items?category=Elektronik');
  });

  test('buildUrlTemplate replaces a variable path segment/query param with {name}', () => {
    const parts = {
      origin: 'https://example.com',
      pathSegments: [{ value: 'api', variable: false, name: '' }, { value: '42', variable: true, name: 'id' }],
      queryParams: [{ key: 'category', value: 'Elektronik', variable: true, name: 'category' }],
    };
    expect(buildUrlTemplate(parts)).toBe('https://example.com/api/{id}?category={category}');
  });

  test('buildUrlTemplate re-encodes a literal query value (URLSearchParams decodes it on the way in)', () => {
    const parts = parseUrlTemplateParts('https://example.com/api?q=a%20b%26c');
    expect(buildUrlTemplate(parts)).toBe('https://example.com/api?q=a%20b%26c');
  });
});

describe('parseValueListInput / buildStaticListSource / buildDiscoverySource / buildRangeSource', () => {
  test('splits on commas and newlines, trims, drops empties', () => {
    expect(parseValueListInput('a, b,\nc , ,')).toEqual(['a', 'b', 'c']);
  });

  test('treats missing input as no values', () => {
    expect(parseValueListInput(undefined)).toEqual([]);
  });

  test('buildStaticListSource wraps parsed values with the staticList discriminator', () => {
    expect(buildStaticListSource('Elektronik, Bücher')).toEqual({ kind: 'staticList', values: ['Elektronik', 'Bücher'] });
  });

  test('buildDiscoverySource carries the discriminator and all three fields', () => {
    expect(buildDiscoverySource('https://example.com/api/categories', 'data', 'slug')).toEqual({
      kind: 'discovery', urlTemplate: 'https://example.com/api/categories', itemsPath: 'data', valuePath: 'slug',
    });
  });

  test('buildRangeSource carries the discriminator, type and bounds', () => {
    expect(buildRangeSource('IsoWeek', '2026-W01', 'today')).toEqual({ kind: 'range', type: 'IsoWeek', from: '2026-W01', to: 'today' });
  });

  test('buildRangeSource includes format when set (bug/api-range-format follow-up)', () => {
    expect(buildRangeSource('IsoWeek', '2026-35', '2026-50', '{yyyy}-{ww}')).toEqual({
      kind: 'range', type: 'IsoWeek', from: '2026-35', to: '2026-50', format: '{yyyy}-{ww}',
    });
  });

  test('buildRangeSource omits format entirely when unset', () => {
    const source = buildRangeSource('Number', '1', '10', null);
    expect(source).not.toHaveProperty('format');
  });

  // Issue #216: deliberately no URL-match-pattern field — see
  // BrowserDiscoverySource's own doc comment (companion IR/ApiConfig.cs).
  test('buildBrowserDiscoverySource carries the discriminator, DiscoveryUrl and actions', () => {
    const actions = [{ kind: 'click', selector: '#load-more' }];
    expect(buildBrowserDiscoverySource('https://example.com/angebote', actions)).toEqual({
      kind: 'browserDiscovery', discoveryUrl: 'https://example.com/angebote', actions,
    });
  });

  test('buildBrowserDiscoverySource omits actions entirely when empty/unset', () => {
    expect(buildBrowserDiscoverySource('https://example.com/angebote')).toEqual({
      kind: 'browserDiscovery', discoveryUrl: 'https://example.com/angebote',
    });
    expect(buildBrowserDiscoverySource('https://example.com/angebote', [])).toEqual({
      kind: 'browserDiscovery', discoveryUrl: 'https://example.com/angebote',
    });
  });
});

// ── findUrlTemplateMatches / mergeValueListValues (API-mode: auto-fill a ──
// StaticListSource's value list from the recorded request pool) ───────────
describe('findUrlTemplateMatches', () => {
  // /api/category/obst/products → segments [api, category, obst, products]
  // — the literal "category" segment sits at index 1, the actual value
  // ("obst") at index 2, so path:2 is the part under test throughout.
  test('extracts a variable path segment\'s value from sibling requests with the same URL shape', () => {
    const urlParts = parseUrlTemplateParts('https://shop.example.com/api/category/obst/products');
    urlParts.pathSegments[2].variable = true; // "obst"

    const entries = [
      { url: 'https://shop.example.com/api/category/obst/products' }, // the confirmed candidate itself
      { url: 'https://shop.example.com/api/category/gemuese/products' },
      { url: 'https://shop.example.com/api/category/tiefkuehl/products' },
    ];

    expect(findUrlTemplateMatches(urlParts, 'path:2', entries)).toEqual(['obst', 'gemuese', 'tiefkuehl']);
  });

  test('rejects an entry whose fixed segments differ, even if the segment count matches', () => {
    const urlParts = parseUrlTemplateParts('https://shop.example.com/api/category/obst/products');
    urlParts.pathSegments[2].variable = true;

    const entries = [
      { url: 'https://shop.example.com/api/brand/obst/products' }, // "brand" instead of "category" — different endpoint shape
      { url: 'https://shop.example.com/api/category/gemuese/reviews' }, // different fixed trailing segment
    ];

    expect(findUrlTemplateMatches(urlParts, 'path:2', entries)).toEqual([]);
  });

  test('rejects an entry from a different origin or with a different segment count', () => {
    const urlParts = parseUrlTemplateParts('https://shop.example.com/api/category/obst/products');
    urlParts.pathSegments[2].variable = true;

    const entries = [
      { url: 'https://other.example.com/api/category/gemuese/products' },
      { url: 'https://shop.example.com/api/category/gemuese/products/extra' },
    ];

    expect(findUrlTemplateMatches(urlParts, 'path:2', entries)).toEqual([]);
  });

  test('extracts a variable query param\'s value, requiring the same query-key set', () => {
    const urlParts = parseUrlTemplateParts('https://shop.example.com/api/products?category=obst&page=1');
    urlParts.queryParams[0].variable = true; // "category"

    const entries = [
      { url: 'https://shop.example.com/api/products?category=gemuese&page=1' },
      { url: 'https://shop.example.com/api/products?category=tiefkuehl&page=2' }, // "page" (fixed here) differs → not a sibling
      { url: 'https://shop.example.com/api/products?category=fleisch' }, // missing "page" entirely → different shape
    ];

    expect(findUrlTemplateMatches(urlParts, 'query:category', entries)).toEqual(['gemuese']);
  });

  test('leaves other variable parts free to differ without affecting the match', () => {
    // /api/category/obst/week/2026-01 → [api, category, obst, week, 2026-01]
    const urlParts = parseUrlTemplateParts('https://shop.example.com/api/category/obst/week/2026-01');
    urlParts.pathSegments[2].variable = true; // category value
    urlParts.pathSegments[4].variable = true; // week value — parameterized independently

    const entries = [
      { url: 'https://shop.example.com/api/category/gemuese/week/2026-07' },
    ];

    expect(findUrlTemplateMatches(urlParts, 'path:2', entries)).toEqual(['gemuese']);
  });

  test('deduplicates repeated values and ignores unparseable URLs', () => {
    const urlParts = parseUrlTemplateParts('https://shop.example.com/api/category/obst/products');
    urlParts.pathSegments[2].variable = true;

    const entries = [
      { url: 'https://shop.example.com/api/category/gemuese/products' },
      { url: 'https://shop.example.com/api/category/gemuese/products' }, // duplicate
      { url: 'not a url' },
    ];

    expect(findUrlTemplateMatches(urlParts, 'path:2', entries)).toEqual(['gemuese']);
  });

  test('an empty/missing entries pool yields no matches', () => {
    const urlParts = parseUrlTemplateParts('https://shop.example.com/api/category/obst/products');
    urlParts.pathSegments[2].variable = true;
    expect(findUrlTemplateMatches(urlParts, 'path:2', [])).toEqual([]);
    expect(findUrlTemplateMatches(urlParts, 'path:2', undefined)).toEqual([]);
  });
});

describe('mergeValueListValues', () => {
  test('appends new values not already present, comma/newline-split like parseValueListInput', () => {
    const { text, addedCount } = mergeValueListValues('obst, gemuese', ['gemuese', 'tiefkuehl']);
    expect(text).toBe('obst, gemuese\ntiefkuehl');
    expect(addedCount).toBe(1);
  });

  test('reports zero added and returns the text unchanged when every value is already present', () => {
    const { text, addedCount } = mergeValueListValues('obst, gemuese', ['obst', 'gemuese']);
    expect(text).toBe('obst, gemuese');
    expect(addedCount).toBe(0);
  });

  test('starting from empty text just becomes the new values, one per line', () => {
    const { text, addedCount } = mergeValueListValues('', ['obst', 'gemuese']);
    expect(text).toBe('obst\ngemuese');
    expect(addedCount).toBe(2);
  });

  test('treats missing existing text the same as empty', () => {
    expect(mergeValueListValues(undefined, ['obst'])).toEqual({ text: 'obst', addedCount: 1 });
  });
});

// ── Range format presets (bug/api-range-format follow-up) ──────────────────
// The bug this fixes: a site (penny.de) encodes a year-week as "2026-35" in
// its own URL, not ISO-8601's "2026-W35" — these functions let the popup
// suggest/validate a matching format instead of requiring the user to type
// "{yyyy}-{ww}" by hand.

describe('detectRangeFormat', () => {
  test('matches the captured raw value against a non-default preset (the reported bug\'s exact case)', () => {
    expect(detectRangeFormat('IsoWeek', '2026-35')).toBe('{yyyy}-{ww}');
  });

  test('falls back to the ISO-Standard preset (always first) when nothing matches', () => {
    expect(detectRangeFormat('IsoWeek', 'not-a-week')).toBe('{yyyy}-W{ww}');
  });

  test('falls back to the ISO-Standard preset when there is no raw value yet', () => {
    expect(detectRangeFormat('IsoWeek', undefined)).toBe('{yyyy}-W{ww}');
    expect(detectRangeFormat('Date', '')).toBe('{yyyy}-{mm}-{dd}');
  });

  test('matches a German date format', () => {
    expect(detectRangeFormat('Date', '28.08.2026')).toBe('{dd}.{mm}.{yyyy}');
  });

  test('returns null for Number, which has no format concept', () => {
    expect(detectRangeFormat('Number', '5')).toBeNull();
  });
});

describe('rangeFormatExample', () => {
  test('echoes the From value once it matches the format', () => {
    expect(rangeFormatExample('{yyyy}-{ww}', '2026-35')).toBe('2026-35');
  });

  test('shows the bare token template when From does not match yet', () => {
    expect(rangeFormatExample('{yyyy}-W{ww}', '2026-35')).toBe('{yyyy}-W{ww}');
  });

  test('shows the bare token template when From is empty', () => {
    expect(rangeFormatExample('{yyyy}-{mm}-{dd}', '')).toBe('{yyyy}-{mm}-{dd}');
  });

  test('returns null when the format itself is empty ("Eigenes Format…" before typing) — the caller shows a translated prompt', () => {
    expect(rangeFormatExample('', '2026-35')).toBeNull();
  });
});

describe('findUrlPartValue', () => {
  const urlParts = {
    origin: 'https://www.penny.de',
    pathSegments: [
      { value: '.rest', variable: false, name: '' },
      { value: '2026-35', variable: true, name: 'KW' },
    ],
    queryParams: [{ key: 'category', value: 'Elektronik', variable: true, name: 'category' }],
  };

  test('finds a path segment\'s captured value by partId', () => {
    expect(findUrlPartValue(urlParts, 'path:1')).toBe('2026-35');
  });

  test('finds a query param\'s captured value by partId', () => {
    expect(findUrlPartValue(urlParts, 'query:category')).toBe('Elektronik');
  });

  test('returns undefined for an unknown or non-variable part', () => {
    expect(findUrlPartValue(urlParts, 'path:0')).toBeUndefined(); // not variable
    expect(findUrlPartValue(urlParts, 'query:missing')).toBeUndefined();
  });
});

describe('buildApiHeaders', () => {
  const captured = [
    { name: 'Authorization', value: 'Bearer secret' },
    { name: 'Accept', value: 'application/json' },
    { name: 'X-Trace-Id', value: 'abc123' },
  ];

  test('excludes headers not marked for inclusion', () => {
    const decisions = { Authorization: { include: true, mode: 'literal' } };
    expect(buildApiHeaders(captured, decisions)).toEqual([{ name: 'Authorization', value: 'Bearer secret' }]);
  });

  test('an env-mode header never carries its captured literal value', () => {
    const decisions = { Authorization: { include: true, mode: 'env', envName: 'API_TOKEN' } };
    expect(buildApiHeaders(captured, decisions)).toEqual([{ name: 'Authorization', environmentVariableName: 'API_TOKEN' }]);
  });

  test('a header with no decision at all is excluded (opt-in, not opt-out)', () => {
    expect(buildApiHeaders(captured, {})).toEqual([]);
  });

  test('preserves the captured header order among the included ones', () => {
    const decisions = {
      'X-Trace-Id': { include: true, mode: 'literal' },
      Accept: { include: true, mode: 'literal' },
    };
    expect(buildApiHeaders(captured, decisions).map(h => h.name)).toEqual(['Accept', 'X-Trace-Id']);
  });
});

describe('buildApiConfig', () => {
  test('assembles urlTemplate, itemsPath, fields, parameters and (when present) headers', () => {
    const config = buildApiConfig({
      urlParts: {
        origin: 'https://example.com',
        pathSegments: [{ value: 'api', variable: false, name: '' }, { value: 'items', variable: false, name: '' }],
        queryParams: [{ key: 'category', value: 'Elektronik', variable: true, name: 'category' }],
      },
      itemsPath: 'data.items',
      fields: [{ name: 'Titel', path: 'name' }, { name: 'Preis', path: 'price' }],
      parameterSources: { category: { kind: 'staticList', values: ['Elektronik', 'Bücher'] } },
      capturedHeaders: [{ name: 'Authorization', value: 'Bearer secret' }],
      headerDecisions: { Authorization: { include: true, mode: 'env', envName: 'API_TOKEN' } },
    });

    expect(config).toEqual({
      urlTemplate: 'https://example.com/api/items?category={category}',
      itemsPath: 'data.items',
      fields: [{ name: 'Titel', path: 'name' }, { name: 'Preis', path: 'price' }],
      parameters: [{ name: 'category', source: { kind: 'staticList', values: ['Elektronik', 'Bücher'] } }],
      headers: [{ name: 'Authorization', environmentVariableName: 'API_TOKEN' }],
    });
  });

  test('omits the headers key entirely when nothing was adopted (matches the optional wire field)', () => {
    const config = buildApiConfig({
      urlParts: { origin: 'https://example.com', pathSegments: [{ value: 'api', variable: false, name: '' }], queryParams: [] },
      itemsPath: 'data',
      fields: [{ name: 'Titel', path: 'name' }],
      parameterSources: {},
      capturedHeaders: [],
      headerDecisions: {},
    });

    expect(config).not.toHaveProperty('headers');
  });

  // A fully static endpoint (every part left "fest") is a valid config in
  // its own right, not just an intermediate state before adding a variable
  // — see apiConfigDraftHasAllSourcesChosen, which no longer blocks
  // confirmation in this case.
  test('produces an empty parameters array when every URL part is fixed', () => {
    const config = buildApiConfig({
      urlParts: {
        origin: 'https://example.com',
        pathSegments: [{ value: 'api', variable: false, name: '' }, { value: 'items', variable: false, name: '' }],
        queryParams: [],
      },
      itemsPath: 'data.items',
      fields: [{ name: 'Titel', path: 'name' }],
      parameterSources: {},
      capturedHeaders: [],
      headerDecisions: {},
    });

    expect(config.parameters).toEqual([]);
  });

  test('collects a variable path segment and a variable query param together, in encounter order', () => {
    const config = buildApiConfig({
      urlParts: {
        origin: 'https://example.com',
        pathSegments: [{ value: 'api', variable: false, name: '' }, { value: '42', variable: true, name: 'id' }],
        queryParams: [{ key: 'week', value: '2026-W01', variable: true, name: 'week' }],
      },
      itemsPath: 'data',
      fields: [{ name: 'Titel', path: 'name' }],
      parameterSources: {
        id: { kind: 'staticList', values: ['42'] },
        week: { kind: 'range', type: 'IsoWeek', from: '2026-W01', to: 'today' },
      },
      capturedHeaders: [],
      headerDecisions: {},
    });

    expect(config.parameters.map(p => p.name)).toEqual(['id', 'week']);
  });

  // ── Request body/method (Issue #55, Phase B4) ─────────────────────────

  test('omits method and body when neither is given (matches the optional wire fields)', () => {
    const config = buildApiConfig({
      urlParts: { origin: 'https://example.com', pathSegments: [{ value: 'api', variable: false, name: '' }], queryParams: [] },
      itemsPath: 'data',
      fields: [{ name: 'Titel', path: 'name' }],
      parameterSources: {},
      capturedHeaders: [],
      headerDecisions: {},
    });

    expect(config).not.toHaveProperty('method');
    expect(config).not.toHaveProperty('body');
  });

  test('omits method for a plain GET (matches the companion default) but includes it for POST', () => {
    const base = {
      urlParts: { origin: 'https://example.com', pathSegments: [{ value: 'api', variable: false, name: '' }], queryParams: [] },
      itemsPath: 'data', fields: [{ name: 'Titel', path: 'name' }], parameterSources: {}, capturedHeaders: [], headerDecisions: {},
    };
    expect(buildApiConfig({ ...base, method: 'GET' })).not.toHaveProperty('method');
    expect(buildApiConfig({ ...base, method: 'POST' })).toHaveProperty('method', 'POST');
  });

  test('serializes bodyTree via serializeBodyTree, resolving a variable leaf\'s parameterId to its declared name', () => {
    const config = buildApiConfig({
      urlParts: { origin: 'https://example.com', pathSegments: [{ value: 'api', variable: false, name: '' }], queryParams: [] },
      itemsPath: 'data', fields: [{ name: 'Titel', path: 'name' }],
      parameterSources: { category: { kind: 'staticList', values: ['a'] } },
      capturedHeaders: [], headerDecisions: {},
      method: 'POST',
      bodyTree: {
        kind: 'object',
        properties: {
          fixed: { kind: 'literal', literalKind: 'String', value: 'x' },
          category: { kind: 'variable', literalKind: 'String', value: 'a', parameterId: 'body:0', coerceTo: null },
        },
      },
      bodyParameterNames: ['category'],
      parameterIdToName: { 'body:0': 'category' },
    });

    expect(config.body).toEqual({
      properties: {
        fixed: { kind: 'String', stringValue: 'x' },
        category: { parameterName: 'category' },
      },
    });
    expect(config.parameters).toContainEqual({ name: 'category', source: { kind: 'staticList', values: ['a'] } });
  });

  // ── Embedded JSON source (Issue #136) ─────────────────────────────────

  test('includes embeddedJsonSource as-is when set', () => {
    const config = buildApiConfig({
      urlParts: { origin: 'https://example.com', pathSegments: [{ value: 'products', variable: false, name: '' }], queryParams: [] },
      itemsPath: 'items', fields: [{ name: 'Titel', path: 'title' }],
      parameterSources: {}, capturedHeaders: [], headerDecisions: {},
      embeddedJsonSource: { scriptSelector: '#__NEXT_DATA__' },
    });

    expect(config.embeddedJsonSource).toEqual({ scriptSelector: '#__NEXT_DATA__' });
  });

  test('omits embeddedJsonSource entirely when not given (matches the optional wire field)', () => {
    const config = buildApiConfig({
      urlParts: { origin: 'https://example.com', pathSegments: [{ value: 'products', variable: false, name: '' }], queryParams: [] },
      itemsPath: 'items', fields: [{ name: 'Titel', path: 'title' }],
      parameterSources: {}, capturedHeaders: [], headerDecisions: {},
    });

    expect(config).not.toHaveProperty('embeddedJsonSource');
  });
});

// ── API-Mode request-body tree pure helpers (Issue #55, Phase B4) ──────────

describe('jsonValueToBodyDraft', () => {
  test('converts a nested object/array/scalar JSON value into an all-literal draft tree', () => {
    const draft = jsonValueToBodyDraft({
      query: 'query { items }',
      variables: { category: 'electronics', maxPrice: 500, active: true, note: null },
      tags: ['a', 'b'],
    });

    expect(draft).toEqual({
      kind: 'object',
      properties: {
        query: { kind: 'literal', literalKind: 'String', value: 'query { items }' },
        variables: {
          kind: 'object',
          properties: {
            category: { kind: 'literal', literalKind: 'String', value: 'electronics' },
            maxPrice: { kind: 'literal', literalKind: 'Number', value: 500 },
            active: { kind: 'literal', literalKind: 'Boolean', value: true },
            note: { kind: 'literal', literalKind: 'Null', value: null },
          },
        },
        tags: {
          kind: 'array',
          items: [
            { kind: 'literal', literalKind: 'String', value: 'a' },
            { kind: 'literal', literalKind: 'String', value: 'b' },
          ],
        },
      },
    });
  });

  test('a bare top-level array round-trips as an array draft', () => {
    expect(jsonValueToBodyDraft([1, 2])).toEqual({
      kind: 'array',
      items: [
        { kind: 'literal', literalKind: 'Number', value: 1 },
        { kind: 'literal', literalKind: 'Number', value: 2 },
      ],
    });
  });
});

describe('resolveBodyTreeNode / updateBodyTreeNode', () => {
  const tree = {
    kind: 'object',
    properties: {
      query: { kind: 'literal', literalKind: 'String', value: 'q' },
      variables: {
        kind: 'object',
        properties: { category: { kind: 'literal', literalKind: 'String', value: 'electronics' } },
      },
      tags: { kind: 'array', items: [{ kind: 'literal', literalKind: 'String', value: 'a' }] },
    },
  };

  test('resolves a nested object-key path', () => {
    expect(resolveBodyTreeNode(tree, ['variables', 'category'])).toEqual({ kind: 'literal', literalKind: 'String', value: 'electronics' });
  });

  test('resolves a path through an array index', () => {
    expect(resolveBodyTreeNode(tree, ['tags', 0])).toEqual({ kind: 'literal', literalKind: 'String', value: 'a' });
  });

  test('updates only the targeted node, leaving the rest of the tree untouched (immutable)', () => {
    const updated = updateBodyTreeNode(tree, ['variables', 'category'], node => ({ ...node, value: 'books' }));

    expect(resolveBodyTreeNode(updated, ['variables', 'category']).value).toBe('books');
    expect(resolveBodyTreeNode(tree, ['variables', 'category']).value).toBe('electronics'); // original untouched
    expect(resolveBodyTreeNode(updated, ['query'])).toBe(tree.properties.query); // untouched branch, same reference
  });

  test('updates through an array index', () => {
    const updated = updateBodyTreeNode(tree, ['tags', 0], node => ({ ...node, value: 'b' }));
    expect(resolveBodyTreeNode(updated, ['tags', 0]).value).toBe('b');
  });
});

describe('bodyTreeReferencesParameterId / bodyTreeLeavesAreBound', () => {
  test('finds a variable leaf referencing the given parameter id at any depth', () => {
    const tree = {
      kind: 'object',
      properties: {
        variables: {
          kind: 'object',
          properties: { category: { kind: 'variable', parameterId: 'body:0' } },
        },
      },
    };
    expect(bodyTreeReferencesParameterId(tree, 'body:0')).toBe(true);
    expect(bodyTreeReferencesParameterId(tree, 'body:1')).toBe(false);
  });

  test('finds a variable leaf inside an array too', () => {
    const tree = { kind: 'array', items: [{ kind: 'variable', parameterId: 'path:0' }] };
    expect(bodyTreeReferencesParameterId(tree, 'path:0')).toBe(true);
  });

  test('bodyTreeLeavesAreBound is true when every variable leaf has a parameterId', () => {
    const bound = { kind: 'object', properties: { a: { kind: 'variable', parameterId: 'body:0' }, b: { kind: 'literal', literalKind: 'String', value: 'x' } } };
    expect(bodyTreeLeavesAreBound(bound)).toBe(true);
  });

  test('bodyTreeLeavesAreBound is false when a variable leaf has no parameterId yet', () => {
    const unbound = { kind: 'object', properties: { a: { kind: 'variable', parameterId: null } } };
    expect(bodyTreeLeavesAreBound(unbound)).toBe(false);
  });
});

describe('serializeBodyTree', () => {
  test('serializes object/array/literal/variable nodes into the exact ApiBodyNode wire shape', () => {
    const tree = {
      kind: 'object',
      properties: {
        query: { kind: 'literal', literalKind: 'String', value: 'query { items }' },
        variables: {
          kind: 'object',
          properties: { category: { kind: 'variable', parameterId: 'body:0', coerceTo: null } },
        },
        tags: { kind: 'array', items: [{ kind: 'literal', literalKind: 'Number', value: 1 }] },
      },
    };

    expect(serializeBodyTree(tree, { 'body:0': 'category' })).toEqual({
      properties: {
        query: { kind: 'String', stringValue: 'query { items }' },
        variables: { properties: { category: { parameterName: 'category' } } },
        tags: { items: [{ kind: 'Number', numberValue: 1 }] },
      },
    });
  });

  test('a Boolean literal serializes to boolValue', () => {
    expect(serializeBodyTree({ kind: 'literal', literalKind: 'Boolean', value: true }, {})).toEqual({ kind: 'Boolean', boolValue: true });
  });

  test('omits any value property entirely for a Null literal', () => {
    expect(serializeBodyTree({ kind: 'literal', literalKind: 'Null', value: null }, {})).toEqual({ kind: 'Null' });
  });

  test('includes coerceTo only when set', () => {
    expect(serializeBodyTree({ kind: 'variable', parameterId: 'body:0', coerceTo: 'Number' }, { 'body:0': 'page' }))
      .toEqual({ parameterName: 'page', coerceTo: 'Number' });
    expect(serializeBodyTree({ kind: 'variable', parameterId: 'body:0', coerceTo: null }, { 'body:0': 'page' }))
      .toEqual({ parameterName: 'page' });
  });
});

describe('allParameterParts', () => {
  test('combines variable URL parts and body-only parameters', () => {
    const draft = {
      urlParts: {
        origin: 'https://example.com',
        pathSegments: [{ value: '42', variable: true, name: 'id' }],
        queryParams: [],
      },
      bodyParameters: [{ id: 'body:0', name: 'category' }],
    };

    expect(allParameterParts(draft).map(p => p.id)).toEqual(['path:0', 'body:0']);
  });

  test('an undefined bodyParameters list (no body at all) is treated as empty', () => {
    const draft = { urlParts: { origin: 'https://example.com', pathSegments: [], queryParams: [] } };
    expect(allParameterParts(draft)).toEqual([]);
  });
});

describe('variableUrlParts / apiConfigDraftHasAllSourcesChosen', () => {
  const urlParts = {
    origin: 'https://example.com',
    pathSegments: [{ value: 'api', variable: false, name: '' }, { value: '42', variable: true, name: 'id' }],
    queryParams: [{ key: 'category', value: 'Elektronik', variable: true, name: 'category' }, { key: 'page', value: '1', variable: false, name: 'page' }],
  };

  test('collects only variable parts, tagged with a stable partId', () => {
    expect(variableUrlParts(urlParts).map(p => p.id)).toEqual(['path:1', 'query:category']);
  });

  test('apiConfigDraftHasAllSourcesChosen is true with no variable parts at all (a fully static endpoint is valid)', () => {
    const draft = { urlParts: { origin: 'x', pathSegments: [], queryParams: [] }, parameterSources: {} };
    expect(apiConfigDraftHasAllSourcesChosen(draft)).toBe(true);
  });

  test('requires a chosen source kind for every variable part', () => {
    const draft = { urlParts, parameterSources: { 'path:1': { kind: 'staticList' } } };
    expect(apiConfigDraftHasAllSourcesChosen(draft)).toBe(false); // query:category has none yet

    draft.parameterSources['query:category'] = { kind: 'range' };
    expect(apiConfigDraftHasAllSourcesChosen(draft)).toBe(true);
  });

  test('a variable part with an empty name blocks confirmation even with a source chosen', () => {
    const namelessUrlParts = { ...urlParts, pathSegments: [{ value: '42', variable: true, name: '' }], queryParams: [] };
    const draft = { urlParts: namelessUrlParts, parameterSources: { 'path:0': { kind: 'staticList' } } };
    expect(apiConfigDraftHasAllSourcesChosen(draft)).toBe(false);
  });

  // Field names became editable on the API_CONFIG screen (see
  // renderApiConfigFieldsList) — a blank one couldn't occur before that, so
  // this is the first place a client-side guard against it is needed.
  test('a blank field name blocks confirmation even when every source is otherwise chosen', () => {
    const fullyConfiguredDraft = {
      urlParts, fields: [{ name: '', path: 'name' }],
      parameterSources: { 'path:1': { kind: 'staticList' }, 'query:category': { kind: 'range' } },
    };
    expect(apiConfigDraftHasAllSourcesChosen(fullyConfiguredDraft)).toBe(false);
  });

  test('a missing fields array (older/partial draft shapes) is treated as no fields, not a crash', () => {
    const draft = { urlParts, parameterSources: { 'path:1': { kind: 'staticList' }, 'query:category': { kind: 'range' } } };
    expect(apiConfigDraftHasAllSourcesChosen(draft)).toBe(true);
  });

  // ── Body-only parameters / variable leaves (Issue #55, Phase B4) ───────

  test('a body-only parameter with a chosen source is enough on its own, even with no URL variables at all', () => {
    const noVariableUrlParts = { origin: 'https://example.com', pathSegments: [{ value: 'graphql', variable: false, name: '' }], queryParams: [] };
    const draft = {
      urlParts: noVariableUrlParts,
      bodyParameters: [{ id: 'body:0', name: 'category' }],
      parameterSources: { 'body:0': { kind: 'staticList' } },
      bodyTree: { kind: 'variable', parameterId: 'body:0' },
    };
    expect(apiConfigDraftHasAllSourcesChosen(draft)).toBe(true);
  });

  test('a variable body leaf not yet bound to any parameter blocks confirmation', () => {
    const draft = {
      urlParts, // has variable parts, both fully configured
      parameterSources: { 'path:1': { kind: 'staticList' }, 'query:category': { kind: 'range' } },
      bodyTree: { kind: 'object', properties: { x: { kind: 'variable', parameterId: null } } },
    };
    expect(apiConfigDraftHasAllSourcesChosen(draft)).toBe(false);
  });

  test('a fully-literal bodyTree (no variable leaves at all) never blocks confirmation on its own', () => {
    const draft = {
      urlParts,
      parameterSources: { 'path:1': { kind: 'staticList' }, 'query:category': { kind: 'range' } },
      bodyTree: { kind: 'object', properties: { x: { kind: 'literal', literalKind: 'String', value: 'fixed' } } },
    };
    expect(apiConfigDraftHasAllSourcesChosen(draft)).toBe(true);
  });
});
