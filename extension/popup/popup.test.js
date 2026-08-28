// Mock chrome and fetch before requiring the module so that the async init()
// (wireEvents + storage read + checkCompanion) runs safely without real APIs.
global.chrome = {
  runtime: {
    onMessage: { addListener: jest.fn() },
    sendMessage: jest.fn(),
  },
  tabs: { query: jest.fn() },
  storage: {
    session: {
      get:    jest.fn().mockResolvedValue({}),
      set:    jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    },
  },
};
global.fetch = jest.fn().mockResolvedValue({ ok: false });

const {
  buildScrapingConfig, addField, removeField, escapeHtml, renderFields, STATES,
  formatTreeLabel, renderDomTree, highlightHover, highlightSelected,
  formatLogSection, buildGithubIssueUrl, setLastError, buildVerificationErrorMessage,
  buildGroupNode, buildFieldNode, resolveGroupNode, insertContainerNode, removeGroupTreeNode,
  formatGroupNodeLabel, serializeGroupTree, renderGroupTree, buildConfigExport, hasRepeatingAncestor,
  renderApiCandidates,
  parseUrlTemplateParts, buildUrlTemplate, parseValueListInput,
  buildStaticListSource, buildDiscoverySource, buildRangeSource, buildApiHeaders, buildApiConfig,
  variableUrlParts, apiConfigDraftHasAllSourcesChosen, renderApiConfigScreen,
  detectRangeFormat, findUrlPartValue, rangeFormatExample,
} = require('./popup');

// jsdom's Blob doesn't implement .text() — read via FileReader instead.
function readBlobText(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

// ── buildScrapingConfig ───────────────────────────────────────────────────────

describe('buildScrapingConfig (flat mode)', () => {
  test('produces correct structure with multiple fields', () => {
    const result = buildScrapingConfig('https://example.com', 'flat', [
      { name: 'Titel', selector: 'h1' },
      { name: 'Preis', selector: '.price' },
    ]);
    expect(result).toEqual({
      version: '1',
      url: 'https://example.com',
      fields: [
        { name: 'Titel', selector: 'h1',     attribute: null },
        { name: 'Preis', selector: '.price', attribute: null },
      ],
      outputFormat: 'Csv',
    });
  });

  test('handles empty fields array', () => {
    const result = buildScrapingConfig('https://example.com', 'flat', []);
    expect(result.fields).toEqual([]);
    expect(result.url).toBe('https://example.com');
    expect(result.outputFormat).toBe('Csv');
  });

  test('preserves explicit attribute value', () => {
    const result = buildScrapingConfig('https://x.com', 'flat', [
      { name: 'Link', selector: 'a', attribute: 'href' },
    ]);
    expect(result.fields[0].attribute).toBe('href');
  });
});

describe('buildScrapingConfig (container mode)', () => {
  test('sends groups instead of fields, no outputFormat', () => {
    const groups = [buildGroupNode('Kategorie', 'section.menu-category', true)];
    const result = buildScrapingConfig('https://example.com', 'container', [], groups);

    expect(result).toEqual({
      version: '1',
      url: 'https://example.com',
      groups: [{ name: 'Kategorie', selector: 'section.menu-category', repeating: true, children: [] }],
    });
    expect(result.outputFormat).toBeUndefined();
    expect(result.fields).toBeUndefined();
  });
});

describe('buildScrapingConfig (api mode, Issue #53 Phase 6)', () => {
  test('sends the confirmed apiConfig as-is instead of fields/groups, no outputFormat', () => {
    const apiConfig = {
      urlTemplate: 'https://example.com/api/items?category={category}',
      itemsPath: 'data.items',
      fields: [{ name: 'Titel', path: 'name' }],
      parameters: [{ name: 'category', source: { kind: 'staticList', values: ['Elektronik'] } }],
    };
    const result = buildScrapingConfig('https://example.com', 'api', [], [], apiConfig);

    expect(result).toEqual({ version: '1', url: 'https://example.com', api: apiConfig });
    expect(result.fields).toBeUndefined();
    expect(result.groups).toBeUndefined();
    expect(result.outputFormat).toBeUndefined();
  });
});

// ── buildConfigExport ────────────────────────────────────────────────────────
// Lets a user attach their current Fields/Groups to a bug report — wraps the
// exact wire-format config (buildScrapingConfig) with export metadata.

describe('buildConfigExport', () => {
  test('wraps the flat-mode config with exportedAt and the extension version', () => {
    const fields = [{ name: 'Titel', selector: 'h1', attribute: null }];
    const result = buildConfigExport('https://example.com', 'flat', fields, [], { version: '1.2.3' });

    expect(result.extensionVersion).toBe('1.2.3');
    expect(() => new Date(result.exportedAt).toISOString()).not.toThrow();
    expect(result.config).toEqual(buildScrapingConfig('https://example.com', 'flat', fields, []));
  });

  test('wraps the container-mode config (groups) the same way', () => {
    const groups = [buildGroupNode('Kategorie', 'section.menu-category', true)];
    const result = buildConfigExport('https://example.com', 'container', [], groups, { version: '1.2.3' });

    expect(result.config).toEqual(buildScrapingConfig('https://example.com', 'container', [], groups));
    expect(result.config.groups).toBeDefined();
    expect(result.config.fields).toBeUndefined();
  });

  test('falls back to "?" when no manifest/version is available', () => {
    const result = buildConfigExport('https://example.com', 'flat', [], []);
    expect(result.extensionVersion).toBe('?');
  });

  test('wraps the api-mode config (api) the same way (Issue #53 Phase 6)', () => {
    const apiConfig = { urlTemplate: 'https://example.com/api/{id}', itemsPath: 'data', fields: [], parameters: [] };
    const result = buildConfigExport('https://example.com', 'api', [], [], { version: '1.2.3' }, apiConfig);

    expect(result.config).toEqual(buildScrapingConfig('https://example.com', 'api', [], [], apiConfig));
    expect(result.config.api).toEqual(apiConfig);
  });
});

// ── addField ─────────────────────────────────────────────────────────────────

describe('addField', () => {
  test('appends field with null attribute', () => {
    const result = addField([], 'Titel', 'h1');
    expect(result).toEqual([{ name: 'Titel', selector: 'h1', attribute: null }]);
  });

  test('does not mutate original array', () => {
    const fields = [{ name: 'A', selector: '.a', attribute: null }];
    addField(fields, 'B', '.b');
    expect(fields).toHaveLength(1);
  });

  test('appends to existing fields', () => {
    const fields = [{ name: 'A', selector: '.a', attribute: null }];
    const result = addField(fields, 'B', '.b');
    expect(result).toHaveLength(2);
    expect(result[1].name).toBe('B');
  });
});

// ── removeField ───────────────────────────────────────────────────────────────

describe('removeField', () => {
  const base = [
    { name: 'A', selector: '.a' },
    { name: 'B', selector: '.b' },
    { name: 'C', selector: '.c' },
  ];

  test('removes field at given index', () => {
    const result = removeField(base, 1);
    expect(result).toHaveLength(2);
    expect(result.map(f => f.name)).toEqual(['A', 'C']);
  });

  test('removes first field', () => {
    const result = removeField(base, 0);
    expect(result[0].name).toBe('B');
  });

  test('removes last field', () => {
    const result = removeField(base, 2);
    expect(result[result.length - 1].name).toBe('B');
  });

  test('does not mutate original array', () => {
    removeField(base, 0);
    expect(base).toHaveLength(3);
  });
});

// ── Container-Mode tree helpers ──────────────────────────────────────────────

describe('buildGroupNode / buildFieldNode', () => {
  test('buildGroupNode starts with empty children', () => {
    expect(buildGroupNode('Kategorie', 'section', true)).toEqual({
      kind: 'group', name: 'Kategorie', selector: 'section', repeating: true, children: [],
    });
  });

  test('buildFieldNode nulls attribute unless mode is attribute', () => {
    expect(buildFieldNode('Titel', 'h2', 'text', 'href')).toEqual({
      kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', attribute: null,
    });
    expect(buildFieldNode('Link', 'a', 'attribute', 'href')).toEqual({
      kind: 'field', name: 'Link', selector: 'a', mode: 'attribute', attribute: 'href',
    });
  });
});

describe('resolveGroupNode / insertContainerNode / removeGroupTreeNode', () => {
  const tree = () => [
    {
      kind: 'group', name: 'Kategorie', selector: 'section.menu-category', repeating: true,
      children: [
        { kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', attribute: null },
      ],
    },
  ];

  test('resolveGroupNode returns null for a null/empty path', () => {
    expect(resolveGroupNode(tree(), null)).toBeNull();
    expect(resolveGroupNode(tree(), [])).toBeNull();
  });

  test('resolveGroupNode walks nested paths', () => {
    expect(resolveGroupNode(tree(), [0]).name).toBe('Kategorie');
    expect(resolveGroupNode(tree(), [0, 0]).name).toBe('Titel');
  });

  test('insertContainerNode appends at root when parentPath is null', () => {
    const node = buildGroupNode('Suppen', 'section.soup', true);
    const result = insertContainerNode(tree(), null, node);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual(node);
  });

  test('insertContainerNode appends into a nested group', () => {
    const node = buildFieldNode('Preis', '.price', 'text', null);
    const result = insertContainerNode(tree(), [0], node);
    expect(result[0].children).toHaveLength(2);
    expect(result[0].children[1]).toEqual(node);
  });

  test('insertContainerNode does not mutate the original tree', () => {
    const original = tree();
    insertContainerNode(original, [0], buildFieldNode('X', '.x', 'text', null));
    expect(original[0].children).toHaveLength(1);
  });

  test('removeGroupTreeNode removes a root node', () => {
    const result = removeGroupTreeNode(tree(), [0]);
    expect(result).toEqual([]);
  });

  test('removeGroupTreeNode removes a nested node', () => {
    const result = removeGroupTreeNode(tree(), [0, 0]);
    expect(result[0].children).toEqual([]);
  });
});

// ── hasRepeatingAncestor ─────────────────────────────────────────────────────
// Determines whether a new node's selector will be re-evaluated once per
// repeating instance — see content-script.js's avoidId (an id-based
// selector would then only ever match one of the N instances).

describe('hasRepeatingAncestor', () => {
  const treeWithRepeatingRoot = () => [
    {
      kind: 'group', name: 'Kategorie', selector: 'section.menu-category', repeating: true,
      children: [
        {
          kind: 'group', name: 'Speise', selector: 'li.menu-item', repeating: false,
          children: [],
        },
      ],
    },
  ];

  const treeWithNonRepeatingRoot = () => [
    {
      kind: 'group', name: 'Header', selector: 'header', repeating: false,
      children: [
        { kind: 'field', name: 'Titel', selector: 'h1', mode: 'text', attribute: null },
      ],
    },
  ];

  test('false for a null/empty path', () => {
    expect(hasRepeatingAncestor(treeWithRepeatingRoot(), null)).toBe(false);
    expect(hasRepeatingAncestor(treeWithRepeatingRoot(), [])).toBe(false);
  });

  test('true when the immediate parent is repeating', () => {
    expect(hasRepeatingAncestor(treeWithRepeatingRoot(), [0])).toBe(true);
  });

  test('true when a non-repeating parent has a repeating ancestor further up', () => {
    // path [0, 0] = the non-repeating "Speise" group, nested inside repeating "Kategorie"
    expect(hasRepeatingAncestor(treeWithRepeatingRoot(), [0, 0])).toBe(true);
  });

  test('false when neither the parent nor any ancestor repeats', () => {
    expect(hasRepeatingAncestor(treeWithNonRepeatingRoot(), [0])).toBe(false);
  });
});

describe('serializeGroupTree', () => {
  test('strips internal `kind` and shapes group/field nodes for the wire', () => {
    const groups = [
      {
        kind: 'group', name: 'Kategorie', selector: 'section.menu-category', repeating: true,
        children: [
          { kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', attribute: null },
          { kind: 'field', name: 'Link', selector: 'a', mode: 'attribute', attribute: 'href' },
          { kind: 'field', name: 'Vegan', selector: '.vegan', mode: 'exists', attribute: null },
        ],
      },
    ];

    expect(serializeGroupTree(groups)).toEqual([
      {
        name: 'Kategorie', selector: 'section.menu-category', repeating: true,
        children: [
          { name: 'Titel', selector: 'h2', mode: 'Text' },
          { name: 'Link', selector: 'a', mode: 'Attribute', attribute: 'href' },
          { name: 'Vegan', selector: '.vegan', mode: 'Exists' },
        ],
      },
    ]);
  });

  test('a text/exists field has no attribute key at all', () => {
    const groups = [{ kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', attribute: null }];
    expect(serializeGroupTree(groups)[0]).not.toHaveProperty('attribute');
  });
});

describe('formatGroupNodeLabel', () => {
  test('group label includes repeating/single', () => {
    expect(formatGroupNodeLabel(buildGroupNode('Kategorie', 'section', true))).toBe('Kategorie (wiederholend)');
    expect(formatGroupNodeLabel(buildGroupNode('Header', 'header', false))).toBe('Header (einzeln)');
  });

  test('field label reflects mode', () => {
    expect(formatGroupNodeLabel(buildFieldNode('Titel', 'h2', 'text', null))).toBe('Titel — Text');
    expect(formatGroupNodeLabel(buildFieldNode('Link', 'a', 'attribute', 'href'))).toBe('Link — Attribut: href');
    expect(formatGroupNodeLabel(buildFieldNode('Vegan', '.v', 'exists', null))).toBe('Vegan — Vorhanden?');
  });
});

describe('renderGroupTree', () => {
  beforeEach(() => {
    document.body.innerHTML = '<ul id="group-tree-root"></ul>';
  });

  test('renders nested groups and fields with add/remove buttons', () => {
    renderGroupTree([
      {
        kind: 'group', name: 'Kategorie', selector: 'section.menu-category', repeating: true,
        children: [{ kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', attribute: null }],
      },
    ]);

    const nodes = document.querySelectorAll('.group-tree-node');
    expect(nodes).toHaveLength(2);

    const groupRow = document.querySelector('[data-path="[0]"] > .group-tree-row');
    expect(groupRow.textContent).toContain('Kategorie (wiederholend)');
    expect(groupRow.querySelector('.btn-add-subcontainer')).not.toBeNull();
    expect(groupRow.querySelector('.btn-add-subfield')).not.toBeNull();
    expect(groupRow.querySelector('.btn-remove-group-node')).not.toBeNull();

    const fieldRow = document.querySelector('[data-path="[0,0]"] > .group-tree-row');
    expect(fieldRow.textContent).toContain('Titel — Text');
    expect(fieldRow.querySelector('.btn-add-subcontainer')).toBeNull(); // fields can't have children
    expect(fieldRow.querySelector('.btn-remove-group-node')).not.toBeNull();
  });

  test('nested groups start expanded, unlike the DOM tree view', () => {
    renderGroupTree([
      {
        kind: 'group', name: 'Kategorie', selector: 'section', repeating: true,
        children: [{ kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', attribute: null }],
      },
    ]);
    const childUl = document.querySelector('[data-path="[0]"] > .group-tree-children');
    expect(childUl.classList.contains('hidden')).toBe(false);
  });
});

// ── escapeHtml ────────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  test('escapes <, >, &, and "', () => {
    expect(escapeHtml('<b class="x">a & b</b>')).toBe(
      '&lt;b class=&quot;x&quot;&gt;a &amp; b&lt;/b&gt;'
    );
  });

  test('passes through plain text unchanged', () => {
    expect(escapeHtml('Produkttitel')).toBe('Produkttitel');
  });

  test('coerces non-string to string first', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

// ── renderFields ─────────────────────────────────────────────────────────────

describe('renderFields', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="fields-list"></div>';
  });

  test('sets full selector as title attribute so it is visible despite CSS truncation', () => {
    const longSelector = '#vorspeisen > ul.menu-list > li.item > span.name';
    renderFields([{ name: 'Titel', selector: longSelector, attribute: null }]);

    const selectorEl = document.querySelector('.field-selector');
    expect(selectorEl.title).toBe(longSelector);
    expect(selectorEl.textContent).toBe(longSelector);
  });

  test('sets full name as title attribute too', () => {
    renderFields([{ name: 'Ein sehr langer Feldname', selector: 'h1', attribute: null }]);

    const nameEl = document.querySelector('.field-name');
    expect(nameEl.title).toBe('Ein sehr langer Feldname');
  });
});

describe('renderApiCandidates (Issue #53 Phase 4)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <p id="api-candidates-target"></p>
      <ul id="api-candidates-list"></ul>
    `;
  });

  test('shows the searched-for target and an empty-state message when there are no candidates', () => {
    renderApiCandidates({ target: 'Suppe', candidates: [] });

    expect(document.getElementById('api-candidates-target').textContent).toBe('Gesucht: "Suppe"');
    expect(document.querySelector('.api-candidates-empty')).not.toBeNull();
  });

  test('renders one row per candidate with url/path/value', () => {
    renderApiCandidates({
      target: 'Suppe',
      candidates: [{ url: 'https://example.com/api', method: 'GET', path: 'items[0].name', value: 'Suppe', siblings: [] }],
    });

    const row = document.querySelector('.api-candidate');
    expect(row.querySelector('.api-candidate-url').textContent).toContain('https://example.com/api');
    expect(row.querySelector('.api-candidate-path').textContent).toBe('items[0].name');
    expect(row.querySelector('.api-candidate-value').textContent).toContain('Suppe');
  });

  test('renders a one-click chip per sibling suggestion', () => {
    renderApiCandidates({
      target: 'Suppe',
      candidates: [{ url: 'https://example.com/api', method: 'GET', path: 'items[0].name', value: 'Suppe', siblings: [{ name: 'price', path: 'items[0].price', value: 3.5 }] }],
    });

    const chip = document.querySelector('.api-sibling-chip');
    expect(chip.textContent).toBe('+ price');
  });
});

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

  test('prompts for input when the format itself is empty ("Eigenes Format…" before typing)', () => {
    expect(rangeFormatExample('', '2026-35')).toBe('(Format eingeben)');
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

  test('apiConfigDraftHasAllSourcesChosen is false with no variable parts (Api-Mode needs at least one)', () => {
    const draft = { urlParts: { origin: 'x', pathSegments: [], queryParams: [] }, parameterSources: {} };
    expect(apiConfigDraftHasAllSourcesChosen(draft)).toBe(false);
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
});

describe('renderApiConfigScreen (Issue #53 Phase 5)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <ul id="api-config-fields"></ul>
      <ul id="api-config-segments"></ul>
      <ul id="api-config-query-params"></ul>
      <div id="api-config-parameters"></div>
      <ul id="api-config-headers"></ul>
      <button id="btn-api-config-confirm" disabled></button>
    `;
  });

  const baseDraft = () => ({
    sourceUrl: 'https://example.com/api/items/42?category=Elektronik',
    itemsPath: 'data.items',
    urlParts: {
      origin: 'https://example.com',
      pathSegments: [
        { value: 'api', variable: false, name: '' },
        { value: 'items', variable: false, name: '' },
        { value: '42', variable: false, name: '' },
      ],
      queryParams: [{ key: 'category', value: 'Elektronik', variable: false, name: 'category' }],
    },
    fields: [{ name: 'Titel', path: 'name' }],
    capturedHeaders: [{ name: 'Authorization', value: 'Bearer secret' }],
    parameterSources: {},
    headerDecisions: {},
  });

  test('renders confirmed fields read-only', () => {
    renderApiConfigScreen(baseDraft(), null);
    const row = document.querySelector('#api-config-fields .api-config-field-row');
    expect(row.textContent).toContain('Titel');
    expect(row.textContent).toContain('name');
  });

  test('renders each path segment/query param as a literal row when not variable', () => {
    renderApiConfigScreen(baseDraft(), null);
    const segRows = document.querySelectorAll('#api-config-segments .api-config-part-row');
    expect(segRows).toHaveLength(3);
    expect(segRows[2].querySelector('.api-config-part-value').textContent).toBe('/42');
    expect(segRows[2].querySelector('.api-config-part-name')).toBeNull();
  });

  test('shows a name input once a part is marked variable', () => {
    const draft = baseDraft();
    draft.urlParts.pathSegments[2].variable = true;
    renderApiConfigScreen(draft, null);
    const nameInput = document.querySelector('#api-config-segments .api-config-part-name');
    expect(nameInput).not.toBeNull();
    expect(nameInput.dataset.partId).toBe('path:2');
  });

  // Regression: a query param's key comes straight from the recorded URL —
  // like candidate.url/value elsewhere in this file, that's untrusted input
  // from whatever site was being recorded. partId ("query:<key>") is built
  // from it and interpolated into several innerHTML attribute strings
  // (data-part-id, radio `name`) — a key containing a quote must not be
  // able to break out of the attribute and inject markup.
  test('a query param key with HTML-special characters cannot break out of its innerHTML attribute', () => {
    const draft = baseDraft();
    draft.urlParts.queryParams = [{ key: '"><img src=x onerror=alert(1)>', value: 'v', variable: true, name: 'p' }];
    renderApiConfigScreen(draft, null);

    expect(document.querySelector('#api-config-query-params img')).toBeNull();
    const toggle = document.querySelector('#api-config-query-params .api-config-part-toggle');
    expect(toggle.dataset.partId).toContain('img src=x onerror=alert(1)');

    const card = document.querySelector('#api-config-parameters .api-config-param-card');
    expect(document.querySelector('#api-config-parameters img')).toBeNull();
    expect(card.querySelector('.api-config-source-kind-radio').dataset.partId).toBe(toggle.dataset.partId);
  });

  test('renders one parameter card per variable part', () => {
    const draft = baseDraft();
    draft.urlParts.pathSegments[2].variable = true;
    draft.urlParts.pathSegments[2].name = 'id';
    draft.urlParts.queryParams[0].variable = true;
    renderApiConfigScreen(draft, null);
    const cards = document.querySelectorAll('#api-config-parameters .api-config-param-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].dataset.partId).toBe('path:2');
    expect(cards[1].dataset.partId).toBe('query:category');
  });

  test('renders the static-list textarea when that kind is selected', () => {
    const draft = baseDraft();
    draft.urlParts.pathSegments[2].variable = true;
    draft.parameterSources['path:2'] = { kind: 'staticList', valuesText: 'a, b' };
    renderApiConfigScreen(draft, null);
    expect(document.querySelector('.api-config-static-list').value).toBe('a, b');
  });

  test('renders range type/from/to when that kind is selected', () => {
    const draft = baseDraft();
    draft.urlParts.pathSegments[2].variable = true;
    draft.parameterSources['path:2'] = { kind: 'range', type: 'IsoWeek', from: '2026-W01', to: 'today' };
    renderApiConfigScreen(draft, null);
    expect(document.querySelector('.api-config-range-from').value).toBe('2026-W01');
    expect(document.querySelector('.api-config-range-to').value).toBe('today');
  });

  test('renders a discovery search button, and a summary once a source URL is already set', () => {
    const draft = baseDraft();
    draft.urlParts.pathSegments[2].variable = true;
    draft.parameterSources['path:2'] = { kind: 'discovery', urlTemplate: 'https://example.com/api/categories', itemsPath: 'data', valuePath: 'slug' };
    renderApiConfigScreen(draft, null);
    expect(document.querySelector('.api-config-discovery-search').textContent).toBe('Erneut suchen');
    expect(document.querySelector('.api-candidates-target').textContent).toContain('data');
  });

  test('renders discovery search results scoped to the matching part only', () => {
    const draft = baseDraft();
    draft.urlParts.pathSegments[2].variable = true;
    draft.parameterSources['path:2'] = { kind: 'discovery' };
    const discoveryCandidates = {
      parameter: 'path:2', target: 'Elektronik',
      candidates: [{ url: 'https://example.com/api/categories', method: 'GET', path: 'data[0].name', value: 'Elektronik', itemsPath: 'data', valuePath: 'name' }],
    };
    renderApiConfigScreen(draft, discoveryCandidates);
    expect(document.querySelectorAll('#api-config-parameters .api-candidate')).toHaveLength(1);
    expect(document.querySelector('.api-config-discovery-confirm').dataset.partId).toBe('path:2');
  });

  test('does not render discovery results under an unrelated part', () => {
    const draft = baseDraft();
    draft.urlParts.pathSegments[2].variable = true;
    draft.parameterSources['path:2'] = { kind: 'discovery' };
    const discoveryCandidates = { parameter: 'query:other', target: 'x', candidates: [{ url: 'https://x', method: 'GET', path: 'a[0]', value: 'x', itemsPath: 'a', valuePath: '' }] };
    renderApiConfigScreen(draft, discoveryCandidates);
    expect(document.querySelectorAll('#api-config-parameters .api-candidate')).toHaveLength(0);
  });

  test('renders header rows with an include checkbox, mode controls only once included', () => {
    renderApiConfigScreen(baseDraft(), null);
    const row = document.querySelector('#api-config-headers .api-config-header-row');
    expect(row.querySelector('.api-config-header-include')).not.toBeNull();
    expect(row.querySelector('.api-config-header-mode-radio')).toBeNull();
  });

  test('shows mode radios and an env-name input once a header is included via env mode', () => {
    const draft = baseDraft();
    draft.headerDecisions.Authorization = { include: true, mode: 'env', envName: 'API_TOKEN' };
    renderApiConfigScreen(draft, null);
    expect(document.querySelectorAll('.api-config-header-mode-radio')).toHaveLength(2);
    expect(document.querySelector('.api-config-env-name').value).toBe('API_TOKEN');
  });

  test('shows a placeholder message when no request headers were captured', () => {
    const draft = baseDraft();
    draft.capturedHeaders = [];
    renderApiConfigScreen(draft, null);
    expect(document.querySelector('#api-config-headers .api-candidates-empty')).not.toBeNull();
  });

  test('enables "Übernehmen" only once every variable part has a name and a source kind', () => {
    const draft = baseDraft();
    renderApiConfigScreen(draft, null); // no variable parts at all
    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(true);

    draft.urlParts.pathSegments[2].variable = true;
    draft.urlParts.pathSegments[2].name = 'id';
    draft.parameterSources['path:2'] = { kind: 'staticList', valuesText: '42' };
    renderApiConfigScreen(draft, null);
    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(false);
  });
});

// ── STATES export ─────────────────────────────────────────────────────────────

test('STATES contains expected keys', () => {
  const expected = ['CHECKING_COMPANION', 'COMPANION_ERROR', 'IDLE', 'SELECTING', 'API_CONFIG', 'GENERATING', 'DONE'];
  expected.forEach(key => expect(STATES).toHaveProperty(key));
});

// ── formatTreeLabel ───────────────────────────────────────────────────────────

describe('formatTreeLabel', () => {
  test('tag only when no id or classes', () => {
    expect(formatTreeLabel({ tag: 'p', id: null, classes: [] })).toBe('p');
  });

  test('appends #id', () => {
    expect(formatTreeLabel({ tag: 'section', id: 'main', classes: [] })).toBe('section#main');
  });

  test('appends .class.class for multiple classes', () => {
    expect(formatTreeLabel({ tag: 'li', id: null, classes: ['card', 'active'] })).toBe('li.card.active');
  });

  test('combines id and classes', () => {
    expect(formatTreeLabel({ tag: 'div', id: 'wrap', classes: ['a'] })).toBe('div#wrap.a');
  });
});

// ── DOM tree rendering & highlighting ────────────────────────────────────────

describe('renderDomTree / highlightHover / highlightSelected', () => {
  const sampleTree = {
    tag: 'body', id: null, classes: [], path: [],
    children: [
      {
        tag: 'section', id: 'main', classes: [], path: [0],
        children: [
          { tag: 'p', id: null, classes: ['a'], path: [0, 0], children: [] },
        ],
      },
    ],
  };

  beforeEach(() => {
    document.body.innerHTML = '<ul id="dom-tree-root"></ul>';
    renderDomTree(sampleTree);
  });

  test('renders one <li> per tree node with the node label', () => {
    const nodes = document.querySelectorAll('.dom-tree-node');
    expect(nodes).toHaveLength(3);
    expect(document.querySelector('[data-path="[0]"]').textContent).toContain('section#main');
  });

  test('nested nodes start collapsed', () => {
    const childUl = document.querySelector('[data-path="[0]"] > .dom-tree-children');
    expect(childUl.classList.contains('hidden')).toBe(true);
  });

  test('highlightHover marks the matching row and expands its ancestors', () => {
    highlightHover([0, 0]);
    const row = document.querySelector('[data-path="[0,0]"] > .dom-tree-row');
    expect(row.classList.contains('hover')).toBe(true);

    const ancestorUl = document.querySelector('[data-path="[0]"] > .dom-tree-children');
    expect(ancestorUl.classList.contains('hidden')).toBe(false);
  });

  test('highlightHover clears the previous hover highlight', () => {
    highlightHover([0]);
    highlightHover([0, 0]);
    const previousRow = document.querySelector('[data-path="[0]"] > .dom-tree-row');
    expect(previousRow.classList.contains('hover')).toBe(false);
  });

  test('highlightSelected marks the row as selected', () => {
    highlightSelected([0, 0]);
    const row = document.querySelector('[data-path="[0,0]"] > .dom-tree-row');
    expect(row.classList.contains('selected')).toBe(true);
  });

  test('highlightSelected replaces a previous selection', () => {
    highlightSelected([0]);
    highlightSelected([0, 0]);
    const previousRow = document.querySelector('[data-path="[0]"] > .dom-tree-row');
    expect(previousRow.classList.contains('selected')).toBe(false);
  });
});

// ── SELECTION_UNAVAILABLE ────────────────────────────────────────────────────
// Regression coverage: chrome.tabs.sendMessage(START_SELECTION) rejects when
// the active tab has no content script (chrome://, Web Store, PDF viewer, a
// page open since before the extension reloaded, …). The side panel must
// fall back to IDLE with an explanation instead of being stuck on
// "Klicke ein Element an…" forever.

describe('SELECTION_UNAVAILABLE handling', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden"></section>
      <section id="screen-selecting" class="hidden">
        <button id="btn-add-field"></button>
      </section>
      <div id="error-toast" class="hidden"></div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn() },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue({}),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: false });

    require('./popup');
    await flushMicrotasks();

    document.getElementById('btn-add-field').click(); // → STATES.SELECTING
  });

  test('falls back to IDLE and shows a toast', () => {
    capturedListener({ type: 'SELECTION_UNAVAILABLE', reason: 'no content script' });

    expect(document.getElementById('screen-selecting').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(false);

    const toast = document.getElementById('error-toast');
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(toast.textContent).toContain('nicht möglich');
  });
});

// ── DOM tree loading timeout ─────────────────────────────────────────────────
// Regression coverage: a lost/never-arriving DOM_TREE response used to leave
// the "Lade DOM-Baum…" spinner stuck forever. A timeout must now surface an
// error instead.

describe('DOM tree loading timeout', () => {
  let capturedListener;

  // init() awaits chrome.storage.session.get() and then fetch() (mocked,
  // resolved) before settling on COMPANION_ERROR — flush those microtasks
  // with real timers before switching to fake ones for the timeout itself.
  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle"></section>
      <section id="screen-selecting" class="hidden">
        <button id="btn-add-field"></button>
        <input type="checkbox" id="toggle-dom-view" />
        <div id="dom-tree-wrapper" class="hidden">
          <p id="dom-tree-loading"></p>
          <p id="dom-tree-error" class="hidden"></p>
          <p id="dom-tree-truncated" class="hidden"></p>
          <ul id="dom-tree-root"></ul>
        </div>
      </section>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn() },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue({}),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: false });

    require('./popup');
    await flushMicrotasks();

    document.getElementById('btn-add-field').click(); // → STATES.SELECTING
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('shows an error if no DOM_TREE response arrives within the timeout', () => {
    const toggle = document.getElementById('toggle-dom-view');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));

    expect(document.getElementById('dom-tree-error').classList.contains('hidden')).toBe(true);

    jest.advanceTimersByTime(5000);

    expect(document.getElementById('dom-tree-error').classList.contains('hidden')).toBe(false);
  });

  test('a DOM_TREE response before the timeout clears loading without an error', () => {
    const toggle = document.getElementById('toggle-dom-view');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));

    capturedListener({
      type: 'DOM_TREE',
      tree: { tag: 'body', id: null, classes: [], path: [], children: [] },
      truncated: false,
    });
    jest.advanceTimersByTime(5000);

    expect(document.getElementById('dom-tree-error').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('dom-tree-loading').classList.contains('hidden')).toBe(true);
  });

  test('a DOM_TREE error response surfaces immediately without waiting for the timeout', () => {
    const toggle = document.getElementById('toggle-dom-view');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));

    capturedListener({ type: 'DOM_TREE', tree: null, truncated: false, error: 'boom' });

    expect(document.getElementById('dom-tree-error').classList.contains('hidden')).toBe(false);
  });
});

// ── Bug reporting ─────────────────────────────────────────────────────────────

describe('formatLogSection', () => {
  test('lists entries with timestamp, event and JSON data', () => {
    const entries = [{ ts: '2024-01-01T00:00:00.000Z', event: 'FOO', data: { a: 1 } }];
    const section = formatLogSection('Side Panel', entries);
    expect(section).toContain('## Side Panel');
    expect(section).toContain('2024-01-01T00:00:00.000Z FOO {"a":1}');
  });

  test('omits the data suffix when data is null', () => {
    const entries = [{ ts: 't', event: 'FOO', data: null }];
    expect(formatLogSection('X', entries)).toBe('## X\nt FOO\n');
  });

  test('shows a placeholder for an empty or missing list', () => {
    expect(formatLogSection('Empty', [])).toBe('## Empty\n(keine Einträge)\n');
    expect(formatLogSection('Missing', null)).toBe('## Missing\n(keine Einträge)\n');
  });
});

describe('buildGithubIssueUrl', () => {
  test("points at the repo's new-issue page", () => {
    const url = buildGithubIssueUrl('some report text');
    expect(url.startsWith('https://github.com/Aventinis/Scraping-Factory/issues/new?')).toBe(true);
  });

  test('uses the last reported error as the title when set', () => {
    setLastError('HTTP 500', 'Skript-Generierung');
    const url = buildGithubIssueUrl('report');
    expect(url).toContain(`title=${encodeURIComponent('Fehler: HTTP 500')}`);
  });

  test('embeds the full report body when short', () => {
    const url = buildGithubIssueUrl('a short report');
    const body = decodeURIComponent(url.split('body=')[1]);
    expect(body).toContain('a short report');
    expect(body).not.toContain('gekürzt');
  });

  test('truncates and adds a note when the report is very long', () => {
    const longReport = 'x'.repeat(10000);
    const url = buildGithubIssueUrl(longReport);
    const body = decodeURIComponent(url.split('body=')[1]);
    expect(body).toContain('gekürzt');
    expect(body.length).toBeLessThan(longReport.length);
  });
});

// ── buildVerificationErrorMessage ────────────────────────────────────────────
// The companion generates and actually runs the script against the live
// page before returning it; /generate responds 422 with an `error` message
// describing why that run failed (page unreachable, script raised an
// exception, or it ran cleanly but produced no data at all).

describe('buildVerificationErrorMessage', () => {
  test('uses the error message from the response', () => {
    const msg = buildVerificationErrorMessage({
      error: 'Skript lief fehlerfrei, hat aber keine Daten zurückgegeben (output.csv enthält nur die Kopfzeile).',
    });
    expect(msg).toBe('Skript lief fehlerfrei, hat aber keine Daten zurückgegeben (output.csv enthält nur die Kopfzeile).');
  });

  test('passes through a script-crash error message', () => {
    const msg = buildVerificationErrorMessage({ error: 'Skript (python3) wurde mit Fehler beendet (Exit-Code 1): Traceback...' });
    expect(msg).toBe('Skript (python3) wurde mit Fehler beendet (Exit-Code 1): Traceback...');
  });

  test('handles a missing/empty response gracefully', () => {
    expect(buildVerificationErrorMessage(null)).toBe('Verifikation der Konfiguration fehlgeschlagen.');
    expect(buildVerificationErrorMessage(undefined)).toBe('Verifikation der Konfiguration fehlgeschlagen.');
    expect(buildVerificationErrorMessage({})).toBe('Verifikation der Konfiguration fehlgeschlagen.');
  });
});

describe('generate() surfaces companion verification failures', () => {
  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div id="fields-list"></div>
        <button id="btn-generate"></button>
      </section>
      <section id="screen-generating" class="hidden"></section>
      <div id="error-toast" class="hidden">
        <span id="error-toast-message"></span>
        <button id="btn-report-bug-toast" class="hidden"></button>
      </div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: jest.fn() },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: {
          get: jest.fn().mockResolvedValue({
            fields: [{ name: 'Preis', selector: '.price', attribute: null }],
            url: 'https://example.com',
          }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };

    global.fetch = jest.fn((url) => {
      if (String(url).endsWith('/health')) return Promise.resolve({ ok: true });
      if (String(url).endsWith('/generate')) {
        return Promise.resolve({
          ok: false,
          status: 422,
          json: () => Promise.resolve({
            error: 'Skript lief fehlerfrei, hat aber keine Daten zurückgegeben (output.csv enthält nur die Kopfzeile).',
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, fields restored from storage
  });

  test('shows a toast with the verification error and offers to report it', async () => {
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const toast = document.getElementById('error-toast');
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('error-toast-message').textContent).toContain('keine Daten zurückgegeben');
    expect(document.getElementById('btn-report-bug-toast').classList.contains('hidden')).toBe(false);
  });
});

// ── Container-Mode integration ───────────────────────────────────────────────
// Full flows through the real state machine (mode switch, modal → click-select
// → tree update), mirroring the existing SELECTION_UNAVAILABLE/generate()
// integration tests' DOM-mocking pattern.

describe('Container-Mode integration', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div class="mode-toggle">
          <button id="btn-mode-flat" class="mode-btn active"></button>
          <button id="btn-mode-container" class="mode-btn"></button>
        </div>
        <div id="flat-mode-section">
          <div id="fields-list"></div>
          <button id="btn-add-field"></button>
        </div>
        <div id="container-mode-section" class="hidden">
          <ul id="group-tree-root"></ul>
          <button id="btn-add-root-container"></button>
        </div>
        <button id="btn-generate" disabled></button>
      </section>
      <section id="screen-selecting" class="hidden">
        <input type="checkbox" id="toggle-dom-view" />
        <div id="dom-tree-wrapper" class="hidden">
          <p id="dom-tree-loading"></p>
          <p id="dom-tree-error" class="hidden"></p>
          <p id="dom-tree-truncated" class="hidden"></p>
          <ul id="dom-tree-root"></ul>
        </div>
        <button id="btn-cancel-selection"></button>
      </section>
      <div id="modal-container-new" class="hidden">
        <input id="input-container-name" />
        <input type="radio" name="container-type" id="radio-container-single" checked />
        <input type="radio" name="container-type" id="radio-container-repeating" />
        <button id="btn-container-confirm"></button>
        <button id="btn-container-cancel"></button>
      </div>
      <div id="modal-field-extended" class="hidden">
        <input id="input-field-extended-name" />
        <select id="select-field-mode">
          <option value="text">Text</option>
          <option value="attribute">Attribute</option>
          <option value="exists">Exists</option>
        </select>
        <div id="field-attribute-row" class="hidden">
          <input id="input-field-attribute" />
        </div>
        <button id="btn-field-extended-confirm"></button>
        <button id="btn-field-extended-cancel"></button>
      </div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue({}),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE
  });

  test('switching to container mode clears fields, switching back clears groups', () => {
    document.getElementById('btn-add-field'); // sanity: flat section present
    document.getElementById('btn-mode-container').click();

    expect(document.getElementById('container-mode-section').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('flat-mode-section').classList.contains('hidden')).toBe(true);

    document.getElementById('btn-mode-flat').click();
    expect(document.getElementById('flat-mode-section').classList.contains('hidden')).toBe(false);
  });

  test('root container add: modal first, then click-select inserts the node with no further modal', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();

    expect(document.getElementById('modal-container-new').classList.contains('hidden')).toBe(false);

    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('radio-container-repeating').checked = true;
    document.getElementById('btn-container-confirm').click();

    // avoidId: true — a "Wiederholend" container's own selector must be
    // able to match more than once, which an id-based selector never can.
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'START_SELECTION', scopeSelector: null, avoidId: true });
    expect(document.getElementById('screen-selecting').classList.contains('hidden')).toBe(false);

    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();

    // Back to IDLE, node inserted, no modal shown for the container case.
    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('modal-field-extended').classList.contains('hidden')).toBe(true);
    const row = document.querySelector('#group-tree-root .group-tree-row');
    expect(row.textContent).toContain('Vorspeisen (wiederholend)');
  });

  test('field add within a container: click-select first, then the extended modal, scoped to the parent selector', async () => {
    // Seed one root container so we have a parent to add a field into.
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();
    chrome.runtime.sendMessage.mockClear();

    document.querySelector('.btn-add-subfield').click();
    // avoidId: false — "Vorspeisen" here was added as "Einzeln" (default),
    // so its own selector only needs to match once.
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'START_SELECTION', scopeSelector: 'section.menu-category', avoidId: false,
    });

    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'h2.category-title' });
    await flushMicrotasks();

    // Now the extended modal shows (unlike the container case above).
    expect(document.getElementById('modal-field-extended').classList.contains('hidden')).toBe(false);

    document.getElementById('input-field-extended-name').value = 'Titel';
    document.getElementById('btn-field-extended-confirm').click();

    const rows = document.querySelectorAll('#group-tree-root .group-tree-row');
    expect(rows[1].textContent).toContain('Titel — Text');
  });

  test('choosing "Attribut" reveals the attribute-name input, and it is required to confirm', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();

    document.querySelector('.btn-add-subfield').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'a.link' });
    await flushMicrotasks();

    const modeSelect = document.getElementById('select-field-mode');
    modeSelect.value = 'attribute';
    modeSelect.dispatchEvent(new Event('change'));
    expect(document.getElementById('field-attribute-row').classList.contains('hidden')).toBe(false);

    document.getElementById('input-field-extended-name').value = 'Link';
    document.getElementById('btn-field-extended-confirm').click();
    // No attribute entered — should not have been added.
    expect(document.querySelectorAll('#group-tree-root .group-tree-row')).toHaveLength(1);

    document.getElementById('input-field-attribute').value = 'href';
    document.getElementById('btn-field-extended-confirm').click();
    const rows = document.querySelectorAll('#group-tree-root .group-tree-row');
    expect(rows[1].textContent).toContain('Link — Attribut: href');
  });

  // Regression: an id-bearing element used to always short-circuit to an id
  // selector, which can only ever match once — silently starving every
  // repetition but the first. avoidId must propagate down from a repeating
  // ancestor even to a nested container that is itself "Einzeln".
  test('nested container add inherits avoidId:true from a repeating ancestor, even if itself "Einzeln"', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Kategorien';
    document.getElementById('radio-container-repeating').checked = true;
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();
    chrome.runtime.sendMessage.mockClear();

    document.querySelector('.btn-add-subcontainer').click();
    document.getElementById('input-container-name').value = 'Badge';
    // "Einzelnes Element" is the modal's default — left unchanged here.
    document.getElementById('btn-container-confirm').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'START_SELECTION', scopeSelector: 'section.menu-category', avoidId: true,
    });
  });
});

// ── Konfiguration exportieren (btn-export-config) ────────────────────────────

describe('downloadConfigExport (btn-export-config)', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div class="mode-toggle">
          <button id="btn-mode-flat" class="mode-btn active"></button>
          <button id="btn-mode-container" class="mode-btn"></button>
        </div>
        <div id="flat-mode-section">
          <div id="fields-list"></div>
          <button id="btn-add-field"></button>
        </div>
        <div id="container-mode-section" class="hidden">
          <ul id="group-tree-root"></ul>
          <button id="btn-add-root-container"></button>
        </div>
        <button id="btn-generate" disabled></button>
        <button id="btn-export-config" disabled></button>
      </section>
      <section id="screen-selecting" class="hidden">
        <input type="checkbox" id="toggle-dom-view" />
        <div id="dom-tree-wrapper" class="hidden">
          <p id="dom-tree-loading"></p>
          <p id="dom-tree-error" class="hidden"></p>
          <p id="dom-tree-truncated" class="hidden"></p>
          <ul id="dom-tree-root"></ul>
        </div>
      </section>
      <div id="modal-container-new" class="hidden">
        <input id="input-container-name" />
        <input type="radio" name="container-type" id="radio-container-single" checked />
        <input type="radio" name="container-type" id="radio-container-repeating" />
        <button id="btn-container-confirm"></button>
      </div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
        getManifest: jest.fn().mockReturnValue({ version: '9.9.9-test' }),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com/speisekarte' }])) },
      storage: {
        session: {
          get: jest.fn().mockResolvedValue({
            fields: [{ name: 'Titel', selector: 'h1', attribute: null }],
            url: 'https://example.com/speisekarte',
          }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = jest.fn();

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, fields restored from storage
  });

  test('is disabled with no fields, enabled once a field exists (flat mode)', () => {
    expect(document.getElementById('btn-export-config').disabled).toBe(false); // seeded with one field above
  });

  test('downloads a JSON file containing the exact /generate config plus export metadata', async () => {
    document.getElementById('btn-export-config').click();

    expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blobArg = global.URL.createObjectURL.mock.calls[0][0];
    expect(blobArg.type).toBe('application/json');

    const text = await readBlobText(blobArg);
    const parsed = JSON.parse(text);

    expect(parsed.extensionVersion).toBe('9.9.9-test');
    expect(parsed.config).toEqual({
      version: '1',
      url: 'https://example.com/speisekarte',
      fields: [{ name: 'Titel', selector: 'h1', attribute: null }],
      outputFormat: 'Csv',
    });
  });

  test('exports groups instead of fields once a container has been added', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('radio-container-repeating').checked = true;
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();

    expect(document.getElementById('btn-export-config').disabled).toBe(false);

    document.getElementById('btn-export-config').click();
    const blobArg = global.URL.createObjectURL.mock.calls[0][0];
    const parsed = JSON.parse(await readBlobText(blobArg));

    expect(parsed.config).toEqual({
      version: '1',
      url: 'https://example.com/speisekarte',
      groups: [{ name: 'Vorspeisen', selector: 'section.menu-category', repeating: true, children: [] }],
    });
  });
});

describe('reportBug end-to-end via the COMPANION_ERROR screen button', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-error" class="hidden">
        <button id="btn-report-bug-error"></button>
      </section>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn().mockResolvedValue({ background: [{ ts: 't', event: 'SW_EVENT', data: null }], content: [], contentError: null }),
        getManifest: jest.fn().mockReturnValue({ version: '0.1.0-test' }),
      },
      tabs: { query: jest.fn(), create: jest.fn() },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue({}),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockRejectedValue(new Error('Companion nicht erreichbar'));
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = jest.fn();

    require('./popup');
    await flushMicrotasks(); // → STATES.COMPANION_ERROR, lastReportedError set
  });

  test('downloads a bug-report.log and opens a prefilled GitHub issue tab', async () => {
    document.getElementById('btn-report-bug-error').click();
    await flushMicrotasks();

    expect(global.URL.createObjectURL).toHaveBeenCalled();
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);

    const { url } = chrome.tabs.create.mock.calls[0][0];
    expect(url).toContain('https://github.com/Aventinis/Scraping-Factory/issues/new');
    expect(decodeURIComponent(url)).toContain('Companion nicht erreichbar');
    expect(decodeURIComponent(url)).toContain('SW_EVENT');
  });
});

describe('Preview toggle (btn-preview)', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div class="mode-toggle">
          <button id="btn-mode-flat" class="mode-btn active"></button>
          <button id="btn-mode-container" class="mode-btn"></button>
        </div>
        <div id="flat-mode-section">
          <div id="fields-list"></div>
          <button id="btn-add-field"></button>
        </div>
        <div id="container-mode-section" class="hidden">
          <ul id="group-tree-root"></ul>
          <button id="btn-add-root-container"></button>
        </div>
        <button id="btn-preview" disabled></button>
        <p id="preview-summary" class="hidden"></p>
        <button id="btn-generate" disabled></button>
      </section>
      <section id="screen-selecting" class="hidden">
        <input type="checkbox" id="toggle-dom-view" />
        <div id="dom-tree-wrapper" class="hidden">
          <p id="dom-tree-loading"></p>
          <p id="dom-tree-error" class="hidden"></p>
          <p id="dom-tree-truncated" class="hidden"></p>
          <ul id="dom-tree-root"></ul>
        </div>
      </section>
      <div id="modal-field-name" class="hidden">
        <input id="input-field-name" />
        <button id="btn-field-confirm"></button>
        <button id="btn-field-cancel"></button>
      </div>
      <div id="error-toast" class="hidden">
        <span id="error-toast-message"></span>
        <button id="btn-report-bug-toast" class="hidden"></button>
      </div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: {
          get: jest.fn().mockResolvedValue({
            fields: [{ name: 'Titel', selector: 'h1', attribute: null }],
            url: 'https://example.com',
          }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, one field restored from storage
  });

  test('disabled with no config, enabled once a field exists (seeded above)', () => {
    expect(document.getElementById('btn-preview').disabled).toBe(false);
  });

  test('clicking sends PREVIEW_START with the current mode/fields and turns the button active', () => {
    document.getElementById('btn-preview').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'PREVIEW_START',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
    });
    expect(document.getElementById('btn-preview').classList.contains('active')).toBe(true);
  });

  test('clicking again sends PREVIEW_STOP and turns the button back off', () => {
    document.getElementById('btn-preview').click();
    chrome.runtime.sendMessage.mockClear();

    document.getElementById('btn-preview').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'PREVIEW_STOP' });
    expect(document.getElementById('btn-preview').classList.contains('active')).toBe(false);
  });

  test('a PREVIEW_RESULT while active fills in the summary line', () => {
    document.getElementById('btn-preview').click();
    capturedListener({ type: 'PREVIEW_RESULT', total: 4, empty: [], truncated: false });

    const summary = document.getElementById('preview-summary');
    expect(summary.classList.contains('hidden')).toBe(false);
    expect(summary.textContent).toContain('4 Element(e) markiert');
    expect(summary.classList.contains('warn')).toBe(false);
  });

  test('a PREVIEW_RESULT with empty fields lists them and adds the warn style', () => {
    document.getElementById('btn-preview').click();
    capturedListener({ type: 'PREVIEW_RESULT', total: 1, empty: ['Preis'], truncated: false });

    const summary = document.getElementById('preview-summary');
    expect(summary.textContent).toContain('ohne Treffer: Preis');
    expect(summary.classList.contains('warn')).toBe(true);
  });

  test('PREVIEW_UNAVAILABLE turns preview off and shows a toast', () => {
    document.getElementById('btn-preview').click();
    capturedListener({ type: 'PREVIEW_UNAVAILABLE', reason: 'no content script' });

    expect(document.getElementById('btn-preview').classList.contains('active')).toBe(false);
    const toast = document.getElementById('error-toast');
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(toast.textContent).toContain('nicht möglich');
  });

  test('adding a new field while preview is active stops it first', async () => {
    document.getElementById('btn-preview').click();
    expect(document.getElementById('btn-preview').classList.contains('active')).toBe(true);
    chrome.runtime.sendMessage.mockClear();

    document.getElementById('btn-add-field').click(); // → STATES.SELECTING

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'PREVIEW_STOP' });
    expect(document.getElementById('btn-preview').classList.contains('active')).toBe(false);
  });

  test('switching mode while preview is active stops it first', () => {
    document.getElementById('btn-preview').click();
    chrome.runtime.sendMessage.mockClear();

    document.getElementById('btn-mode-container').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'PREVIEW_STOP' });
  });

  test('removing a field while preview is active stops it first', () => {
    document.getElementById('btn-preview').click();
    chrome.runtime.sendMessage.mockClear();

    document.querySelector('.btn-remove-field').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'PREVIEW_STOP' });
  });
});

// API-Mode network recording (Issue #53 Phase 3) — a standalone toggle, not
// gated by Fields/Groups config the way btn-preview is (no third API mode
// in the popup yet, see btn-mode-flat/-container).
describe('Network recording toggle (btn-api-capture)', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div class="mode-toggle">
          <button id="btn-mode-flat" class="mode-btn active"></button>
          <button id="btn-mode-container" class="mode-btn"></button>
        </div>
        <div id="flat-mode-section">
          <div id="fields-list"></div>
          <button id="btn-add-field"></button>
        </div>
        <div id="container-mode-section" class="hidden">
          <ul id="group-tree-root"></ul>
          <button id="btn-add-root-container"></button>
        </div>
        <button id="btn-preview" disabled></button>
        <p id="preview-summary" class="hidden"></p>
        <button id="btn-api-capture"></button>
        <p id="api-capture-summary" class="hidden"></p>
        <button id="btn-generate" disabled></button>
      </section>
      <section id="screen-selecting" class="hidden">
        <input type="checkbox" id="toggle-dom-view" />
        <div id="dom-tree-wrapper" class="hidden">
          <p id="dom-tree-loading"></p>
          <p id="dom-tree-error" class="hidden"></p>
          <p id="dom-tree-truncated" class="hidden"></p>
          <ul id="dom-tree-root"></ul>
        </div>
      </section>
      <div id="modal-field-name" class="hidden">
        <input id="input-field-name" />
        <button id="btn-field-confirm"></button>
        <button id="btn-field-cancel"></button>
      </div>
      <div id="error-toast" class="hidden">
        <span id="error-toast-message"></span>
        <button id="btn-report-bug-toast" class="hidden"></button>
      </div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: {
          get: jest.fn().mockResolvedValue({ url: 'https://example.com' }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE
  });

  test('clicking sends API_CAPTURE_START and turns the button active', () => {
    document.getElementById('btn-api-capture').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'API_CAPTURE_START' });
    expect(document.getElementById('btn-api-capture').classList.contains('active')).toBe(true);
    expect(document.getElementById('btn-api-capture').textContent).toContain('beenden');
  });

  test('clicking again sends API_CAPTURE_STOP and turns the button back off', () => {
    document.getElementById('btn-api-capture').click();
    chrome.runtime.sendMessage.mockClear();

    document.getElementById('btn-api-capture').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'API_CAPTURE_STOP' });
    expect(document.getElementById('btn-api-capture').classList.contains('active')).toBe(false);
  });

  test('API_CAPTURE_ENTRY messages increment the recorded-count summary while active', () => {
    document.getElementById('btn-api-capture').click();

    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api/a' } });
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 2, url: 'https://example.com/api/b' } });

    const summary = document.getElementById('api-capture-summary');
    expect(summary.classList.contains('hidden')).toBe(false);
    expect(summary.textContent).toContain('2 Anfrage(n) aufgezeichnet');
  });

  test('API_CAPTURE_ENTRY messages are ignored while recording is not active', () => {
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api/a' } });

    const summary = document.getElementById('api-capture-summary');
    expect(summary.classList.contains('hidden')).toBe(true);
  });

  test('stopping keeps the recorded-count summary visible (Phase 4 searches it after stopping)', () => {
    document.getElementById('btn-api-capture').click();
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api/a' } });

    document.getElementById('btn-api-capture').click();

    const summary = document.getElementById('api-capture-summary');
    expect(summary.classList.contains('hidden')).toBe(false);
    expect(summary.textContent).toBe('1 Anfrage(n) aufgezeichnet');
  });

  test('starting a new recording resets the count back to 0', () => {
    document.getElementById('btn-api-capture').click();
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api/a' } });
    document.getElementById('btn-api-capture').click(); // stop

    document.getElementById('btn-api-capture').click(); // start again

    expect(document.getElementById('api-capture-summary').classList.contains('hidden')).toBe(true);
  });

  test('API_CAPTURE_UNAVAILABLE turns recording off and shows a toast', () => {
    document.getElementById('btn-api-capture').click();
    capturedListener({ type: 'API_CAPTURE_UNAVAILABLE', reason: 'no content script' });

    expect(document.getElementById('btn-api-capture').classList.contains('active')).toBe(false);
    const toast = document.getElementById('error-toast');
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(toast.textContent).toContain('nicht möglich');
  });
});

describe('API-mode candidate search (btn-api-search, Issue #53 Phase 4)', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <button id="btn-add-field"></button>
        <button id="btn-api-capture"></button>
        <p id="api-capture-summary" class="hidden"></p>
        <button id="btn-api-search" disabled></button>
        <div id="api-candidates-panel" class="hidden">
          <p id="api-candidates-target"></p>
          <ul id="api-candidates-list"></ul>
        </div>
      </section>
      <section id="screen-selecting" class="hidden">
        <button id="btn-cancel-selection"></button>
      </section>
      <div id="modal-field-name" class="hidden">
        <input id="input-field-name" />
        <button id="btn-field-confirm"></button>
        <button id="btn-field-cancel"></button>
      </div>
      <div id="error-toast" class="hidden">
        <span id="error-toast-message"></span>
        <button id="btn-report-bug-toast" class="hidden"></button>
      </div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue({ url: 'https://example.com' }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE
  });

  function recordOneEntry() {
    document.getElementById('btn-api-capture').click(); // start
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api' } });
    document.getElementById('btn-api-capture').click(); // stop — count must survive this, see the recording-toggle tests above
    chrome.runtime.sendMessage.mockClear();
  }

  test('stays disabled until something has been recorded', () => {
    expect(document.getElementById('btn-api-search').disabled).toBe(true);
  });

  test('is enabled once at least one request has been recorded, even after stopping', () => {
    recordOneEntry();
    expect(document.getElementById('btn-api-search').disabled).toBe(false);
  });

  test('clicking sends START_SELECTION with apiSearch:true and switches to the selecting screen', () => {
    recordOneEntry();

    document.getElementById('btn-api-search').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'START_SELECTION', apiSearch: true });
    expect(document.getElementById('screen-selecting').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(true);
  });

  test('an ELEMENT_SELECTED arriving during an api-search round does not open the flat field-name modal', () => {
    recordOneEntry();
    document.getElementById('btn-api-search').click();

    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.price', path: [] });

    expect(document.getElementById('modal-field-name').classList.contains('hidden')).toBe(true);
  });

  test('API_CANDIDATES ends the selection round, returns to idle and renders the results', () => {
    recordOneEntry();
    document.getElementById('btn-api-search').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.price', path: [] });

    const candidates = [{ url: 'https://example.com/api', method: 'GET', path: 'price', value: '3.50', siblings: [] }];
    capturedListener({ type: 'API_CANDIDATES', target: '3.50', candidates });

    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('screen-selecting').classList.contains('hidden')).toBe(true);
    expect(chrome.storage.session.remove).toHaveBeenCalledWith('pendingSelector');

    const panel = document.getElementById('api-candidates-panel');
    expect(panel.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('api-candidates-target').textContent).toBe('Gesucht: "3.50"');
    expect(document.querySelectorAll('.api-candidate')).toHaveLength(1);
  });

  test('cancelling an api-search round clears apiSearchSelecting (a later plain click can open the field modal again)', () => {
    recordOneEntry();
    document.getElementById('btn-api-search').click();

    document.getElementById('btn-cancel-selection').click();
    // A later, unrelated selection round (a normal "+ Feld hinzufügen"
    // click, which also lands in STATES.SELECTING) reaching ELEMENT_SELECTED
    // must behave normally now, not be swallowed by a leftover
    // apiSearchSelecting flag.
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.price', path: [] });

    expect(document.getElementById('modal-field-name').classList.contains('hidden')).toBe(false);
  });
});

describe('API-Mode config screen end-to-end (Issue #53 Phase 5)', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <button id="btn-add-field"></button>
        <button id="btn-api-capture"></button>
        <p id="api-capture-summary" class="hidden"></p>
        <button id="btn-api-search" disabled></button>
        <div id="api-candidates-panel" class="hidden">
          <p id="api-candidates-target"></p>
          <ul id="api-candidates-list"></ul>
        </div>
        <div id="api-config-panel" class="hidden">
          <p id="api-config-summary"></p>
          <button id="btn-api-config-discard"></button>
        </div>
      </section>
      <section id="screen-selecting" class="hidden">
        <button id="btn-cancel-selection"></button>
      </section>
      <section id="screen-api-config" class="hidden">
        <ul id="api-config-fields"></ul>
        <ul id="api-config-segments"></ul>
        <ul id="api-config-query-params"></ul>
        <div id="api-config-parameters"></div>
        <ul id="api-config-headers"></ul>
        <button id="btn-api-config-cancel"></button>
        <button id="btn-api-config-confirm" disabled></button>
      </section>
      <div id="modal-field-name" class="hidden">
        <input id="input-field-name" />
        <button id="btn-field-confirm"></button>
        <button id="btn-field-cancel"></button>
      </div>
      <div id="error-toast" class="hidden">
        <span id="error-toast-message"></span>
        <button id="btn-report-bug-toast" class="hidden"></button>
      </div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue({ url: 'https://example.com' }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE
  });

  const PRIMARY_CANDIDATE = {
    entryId: 1,
    url: 'https://example.com/api/items/42?category=Elektronik',
    method: 'GET',
    path: 'data.items[0].name',
    value: 'Titel-Test',
    siblings: [],
    itemsPath: 'data.items',
    valuePath: 'name',
    requestHeaders: [{ name: 'Authorization', value: 'Bearer secret' }],
  };

  // Drives the popup from a fresh IDLE screen up to a rendered API_CONFIG
  // screen with one confirmed field — the common setup every test below
  // builds on.
  function confirmPrimaryCandidate() {
    document.getElementById('btn-api-capture').click();
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api' } });
    document.getElementById('btn-api-capture').click();

    document.getElementById('btn-api-search').click();
    capturedListener({ type: 'API_CANDIDATES', target: 'Titel-Test', candidates: [PRIMARY_CANDIDATE] });

    const nameInput = document.querySelector('.api-candidate-field-name');
    nameInput.value = 'Titel';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.api-candidate-confirm').click();
  }

  test('confirming a candidate lands on the API_CONFIG screen with the field and decomposed URL', () => {
    confirmPrimaryCandidate();

    expect(document.getElementById('screen-api-config').classList.contains('hidden')).toBe(false);
    const fieldRow = document.querySelector('#api-config-fields .api-config-field-row');
    expect(fieldRow.textContent).toContain('Titel');
    expect(fieldRow.textContent).toContain('name');

    const segRows = document.querySelectorAll('#api-config-segments .api-config-part-row');
    expect(Array.from(segRows).map(r => r.querySelector('.api-config-part-value').textContent)).toEqual(['/api', '/items', '/42']);
    const queryRows = document.querySelectorAll('#api-config-query-params .api-config-part-row');
    expect(queryRows[0].querySelector('.api-config-part-value').textContent).toBe('category=Elektronik');
  });

  test('toggling a path segment variable reveals a name input and, once named, a parameter card', () => {
    confirmPrimaryCandidate();

    const toggle = document.querySelector('#api-config-segments .api-config-part-row:nth-child(3) .api-config-part-toggle');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));

    const nameInput = document.querySelector('#api-config-segments .api-config-part-name');
    expect(nameInput.dataset.partId).toBe('path:2');
    // The card appears as soon as the part is variable — before a name is
    // typed it just shows a placeholder title.
    expect(document.querySelector('#api-config-parameters .api-config-param-card').textContent).toContain('(noch unbenannt)');

    nameInput.value = 'id';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));

    const card = document.querySelector('#api-config-parameters .api-config-param-card');
    expect(card.dataset.partId).toBe('path:2');
    expect(card.textContent).toContain('id');
  });

  test('choosing Werteliste renders a textarea, and typing values keeps "Übernehmen" gated until present', () => {
    confirmPrimaryCandidate();
    const toggle = document.querySelectorAll('#api-config-segments .api-config-part-toggle')[2];
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    const nameInput = document.querySelector('#api-config-segments .api-config-part-name');
    nameInput.value = 'id';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));

    const kindRadio = document.querySelector('.api-config-source-kind-radio[value="staticList"]');
    kindRadio.checked = true;
    kindRadio.dispatchEvent(new Event('change', { bubbles: true }));

    const textarea = document.querySelector('.api-config-static-list');
    expect(textarea).not.toBeNull();
    textarea.value = '42, 43';
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(false);
  });

  test('the discovery round-trip: search, receive scoped candidates, confirm one as the source', () => {
    confirmPrimaryCandidate();

    // Query param "category" already carries its own key as a default name
    // (see parseUrlTemplateParts) — toggling it variable is enough on its
    // own, no name input needed.
    const queryToggle = document.querySelector('#api-config-query-params .api-config-part-toggle');
    queryToggle.checked = true;
    queryToggle.dispatchEvent(new Event('change', { bubbles: true }));

    const discoveryRadio = document.querySelector('.api-config-source-kind-radio[value="discovery"]');
    discoveryRadio.checked = true;
    discoveryRadio.dispatchEvent(new Event('change', { bubbles: true }));

    chrome.runtime.sendMessage.mockClear();
    document.querySelector('.api-config-discovery-search').click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'START_SELECTION', apiSearch: true });
    expect(document.getElementById('screen-selecting').classList.contains('hidden')).toBe(false);

    const discoveryCandidate = {
      entryId: 2, url: 'https://example.com/api/categories', method: 'GET',
      path: 'data[0].name', value: 'Elektronik', siblings: [],
      itemsPath: 'data', valuePath: 'name', requestHeaders: [],
    };
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.cat', path: [] }); // sent alongside, must not open the field modal
    capturedListener({ type: 'API_CANDIDATES', target: 'Elektronik', candidates: [discoveryCandidate] });

    expect(document.getElementById('modal-field-name').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('screen-api-config').classList.contains('hidden')).toBe(false);

    const confirmDiscoveryBtn = document.querySelector('.api-config-discovery-confirm');
    expect(confirmDiscoveryBtn.dataset.partId).toBe('query:category');
    confirmDiscoveryBtn.click();

    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(false);
    expect(document.querySelector('.api-candidates-target').textContent).toContain('https://example.com/api/categories');
  });

  test('a cancelled discovery search returns to API_CONFIG, not IDLE', () => {
    confirmPrimaryCandidate();
    const queryToggle = document.querySelector('#api-config-query-params .api-config-part-toggle');
    queryToggle.checked = true;
    queryToggle.dispatchEvent(new Event('change', { bubbles: true }));
    const discoveryRadio = document.querySelector('.api-config-source-kind-radio[value="discovery"]');
    discoveryRadio.checked = true;
    discoveryRadio.dispatchEvent(new Event('change', { bubbles: true }));

    document.querySelector('.api-config-discovery-search').click();
    document.getElementById('btn-cancel-selection').click();

    expect(document.getElementById('screen-api-config').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(true);
  });

  test('header adoption: including a header via an environment variable', () => {
    confirmPrimaryCandidate();

    const include = document.querySelector('.api-config-header-include');
    include.checked = true;
    include.dispatchEvent(new Event('change', { bubbles: true }));

    const envRadio = document.querySelector('.api-config-header-mode-radio[value="env"]');
    envRadio.checked = true;
    envRadio.dispatchEvent(new Event('change', { bubbles: true }));

    const envInput = document.querySelector('.api-config-env-name');
    envInput.value = 'API_TOKEN';
    envInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.querySelector('.api-config-env-name').value).toBe('API_TOKEN');
  });

  test('"Abbrechen" discards the draft and returns to IDLE', () => {
    confirmPrimaryCandidate();
    document.getElementById('btn-api-config-cancel').click();

    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('api-config-panel').classList.contains('hidden')).toBe(true);
  });

  test('"Übernehmen" assembles the final ApiConfig, persists it, and shows the summary on IDLE', () => {
    confirmPrimaryCandidate();

    const toggle = document.querySelectorAll('#api-config-segments .api-config-part-toggle')[2];
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    const nameInput = document.querySelector('#api-config-segments .api-config-part-name');
    nameInput.value = 'id';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    const kindRadio = document.querySelector('.api-config-source-kind-radio[value="staticList"]');
    kindRadio.checked = true;
    kindRadio.dispatchEvent(new Event('change', { bubbles: true }));
    const textarea = document.querySelector('.api-config-static-list');
    textarea.value = '42';
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    chrome.storage.session.set.mockClear();
    document.getElementById('btn-api-config-confirm').click();

    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('api-config-panel').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('api-config-summary').textContent).toContain('1 Feld(er)');
    expect(document.getElementById('api-config-summary').textContent).toContain('1 Parameter');

    const persistedConfig = chrome.storage.session.set.mock.calls.at(-1)[0].apiConfig;
    expect(persistedConfig).toEqual({
      urlTemplate: 'https://example.com/api/items/{id}?category=Elektronik',
      itemsPath: 'data.items',
      fields: [{ name: 'Titel', path: 'name' }],
      parameters: [{ name: 'id', source: { kind: 'staticList', values: ['42'] } }],
      // No header was ever included (default headerDecisions is empty) — the
      // key is omitted entirely, matching the optional wire field.
    });
    expect(persistedConfig).not.toHaveProperty('headers');
  });

  test('"Verwerfen" on the summary panel clears the confirmed apiConfig', () => {
    confirmPrimaryCandidate();
    const toggle = document.querySelectorAll('#api-config-segments .api-config-part-toggle')[2];
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    const nameInput = document.querySelector('#api-config-segments .api-config-part-name');
    nameInput.value = 'id';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    const kindRadio = document.querySelector('.api-config-source-kind-radio[value="staticList"]');
    kindRadio.checked = true;
    kindRadio.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.api-config-static-list').value = '42';
    document.querySelector('.api-config-static-list').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('btn-api-config-confirm').click();

    document.getElementById('btn-api-config-discard').click();

    expect(document.getElementById('api-config-panel').classList.contains('hidden')).toBe(true);
  });
});

// ── API-Mode: third popup mode, /generate wiring (Issue #53 Phase 6) ────────
// switchMode's three-way clearing and the section-gating in render() — see
// the "Container-Mode integration" suite above for the same pattern applied
// to flat/container.

describe('API-Mode third mode integration (Issue #53 Phase 6)', () => {
  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  const seededApiConfig = {
    urlTemplate: 'https://example.com/api/items?category={category}',
    itemsPath: 'data.items',
    fields: [{ name: 'Titel', path: 'name' }],
    parameters: [{ name: 'category', source: { kind: 'staticList', values: ['Elektronik'] } }],
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div class="mode-toggle">
          <button id="btn-mode-flat" class="mode-btn active"></button>
          <button id="btn-mode-container" class="mode-btn"></button>
          <button id="btn-mode-api" class="mode-btn"></button>
        </div>
        <div id="flat-mode-section">
          <div id="fields-list"></div>
          <button id="btn-add-field"></button>
        </div>
        <div id="container-mode-section" class="hidden">
          <ul id="group-tree-root"></ul>
          <button id="btn-add-root-container"></button>
        </div>
        <div id="api-mode-section" class="hidden">
          <button id="btn-api-capture"></button>
          <p id="api-capture-summary" class="hidden"></p>
          <button id="btn-api-search" disabled></button>
          <div id="api-candidates-panel" class="hidden">
            <p id="api-candidates-target"></p>
            <ul id="api-candidates-list"></ul>
          </div>
          <div id="api-config-panel" class="hidden">
            <p id="api-config-summary"></p>
            <button id="btn-api-config-discard"></button>
          </div>
        </div>
        <div id="preview-section">
          <button id="btn-preview" disabled></button>
          <p id="preview-summary" class="hidden"></p>
        </div>
        <button id="btn-generate" disabled></button>
        <button id="btn-export-config" disabled></button>
      </section>
      <section id="screen-generating" class="hidden"></section>
      <div id="error-toast" class="hidden">
        <span id="error-toast-message"></span>
        <button id="btn-report-bug-toast" class="hidden"></button>
      </div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: jest.fn() },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: {
          get: jest.fn().mockResolvedValue({
            fields: [{ name: 'Titel', selector: 'h1', attribute: null }],
            groups: [],
            apiConfig: seededApiConfig,
            mode: 'flat',
            url: 'https://example.com',
          }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn((url) => {
      if (String(url).endsWith('/generate')) return Promise.resolve({ ok: true, text: () => Promise.resolve('# script') });
      return Promise.resolve({ ok: true });
    });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, fields/apiConfig restored from storage
  });

  test('switching to API mode shows only api-mode-section and hides the (meaningless there) preview toggle', () => {
    document.getElementById('btn-mode-api').click();

    expect(document.getElementById('api-mode-section').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('flat-mode-section').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('container-mode-section').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('preview-section').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('btn-mode-api').classList.contains('active')).toBe(true);
  });

  test('switching to API mode clears fields/groups; switching away clears the confirmed apiConfig', () => {
    expect(document.getElementById('fields-list').children.length).toBe(1);

    document.getElementById('btn-mode-api').click();
    // Fields cleared like the flat↔container switch already does.
    expect(document.getElementById('fields-list').children.length).toBe(0);
    // apiConfig itself is untouched by switching *into* api mode.
    expect(document.getElementById('api-config-panel').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('btn-generate').disabled).toBe(false);

    document.getElementById('btn-mode-flat').click();
    // Fields stayed empty (flat mode only clears groups/apiConfig, not fields).
    expect(document.getElementById('btn-generate').disabled).toBe(true);

    document.getElementById('btn-mode-api').click();
    // apiConfig was cleared by the switch away from api mode above.
    expect(document.getElementById('api-config-panel').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('btn-generate').disabled).toBe(true);
  });

  test('POSTs {version, url, api} — no fields/groups/outputFormat — once in API mode', async () => {
    document.getElementById('btn-mode-api').click();
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const generateCall = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/generate'));
    expect(generateCall).toBeDefined();
    const body = JSON.parse(generateCall[1].body);

    expect(body).toEqual({ version: '1', url: 'https://example.com', api: seededApiConfig });
  });
});

// ── API-Mode range format UI (bug/api-range-format follow-up) ───────────────
// End-to-end reproduction of the reported bug's fix: penny.de encodes a
// year-week as "2026-35" in its own URL, not ISO-8601's "2026-W35" — the
// popup should auto-suggest the matching format the moment "Bereich" is
// picked for that part, instead of requiring the user to type
// "{yyyy}-{ww}" by hand.

describe('API-Mode range format presets (bug/api-range-format follow-up)', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <button id="btn-add-field"></button>
        <button id="btn-api-capture"></button>
        <p id="api-capture-summary" class="hidden"></p>
        <button id="btn-api-search" disabled></button>
        <div id="api-candidates-panel" class="hidden">
          <p id="api-candidates-target"></p>
          <ul id="api-candidates-list"></ul>
        </div>
        <div id="api-config-panel" class="hidden">
          <p id="api-config-summary"></p>
          <button id="btn-api-config-discard"></button>
        </div>
      </section>
      <section id="screen-selecting" class="hidden">
        <button id="btn-cancel-selection"></button>
      </section>
      <section id="screen-api-config" class="hidden">
        <ul id="api-config-fields"></ul>
        <ul id="api-config-segments"></ul>
        <ul id="api-config-query-params"></ul>
        <div id="api-config-parameters"></div>
        <ul id="api-config-headers"></ul>
        <button id="btn-api-config-cancel"></button>
        <button id="btn-api-config-confirm" disabled></button>
      </section>
      <div id="modal-field-name" class="hidden">
        <input id="input-field-name" />
        <button id="btn-field-confirm"></button>
        <button id="btn-field-cancel"></button>
      </div>
      <div id="error-toast" class="hidden">
        <span id="error-toast-message"></span>
        <button id="btn-report-bug-toast" class="hidden"></button>
      </div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://www.penny.de/angebote/' }])) },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue({ url: 'https://www.penny.de/angebote/' }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE
  });

  // Reproduces the reported bug's actual recorded request: path segments
  // are [".rest", "offers", "by-category", "2026-35", "top-angebote"] —
  // "2026-35" at index 3 (nth-child(4) below).
  const PENNY_CANDIDATE = {
    entryId: 1,
    url: 'https://www.penny.de/.rest/offers/by-category/2026-35/top-angebote',
    method: 'GET',
    path: 'offerTiles[0].title',
    value: 'Orangen-Nektar',
    siblings: [],
    itemsPath: 'offerTiles',
    valuePath: 'title',
    requestHeaders: [],
  };

  function confirmPennyCandidate() {
    document.getElementById('btn-api-capture').click();
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: PENNY_CANDIDATE.url } });
    document.getElementById('btn-api-capture').click();

    document.getElementById('btn-api-search').click();
    capturedListener({ type: 'API_CANDIDATES', target: 'Orangen-Nektar', candidates: [PENNY_CANDIDATE] });

    const nameInput = document.querySelector('.api-candidate-field-name');
    nameInput.value = 'Name';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.api-candidate-confirm').click();
  }

  const WEEK_SEGMENT_TOGGLE_SELECTOR = '#api-config-segments .api-config-part-row:nth-child(4) .api-config-part-toggle';

  // Common setup every test below builds on: toggles the "2026-35" segment
  // variable, names it "KW", and picks "Bereich" as its source.
  function selectRangeForWeekPart() {
    const toggle = document.querySelector(WEEK_SEGMENT_TOGGLE_SELECTOR);
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    const nameInput = document.querySelector('#api-config-segments .api-config-part-name');
    nameInput.value = 'KW';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    const rangeRadio = document.querySelector('.api-config-source-kind-radio[value="range"]');
    rangeRadio.checked = true;
    rangeRadio.dispatchEvent(new Event('change', { bubbles: true }));
  }

  test('picking "Bereich" auto-selects the preset matching the captured "2026-35" value', () => {
    confirmPennyCandidate();
    selectRangeForWeekPart();

    const formatSelect = document.querySelector('.api-config-range-format-preset');
    expect(formatSelect.value).toBe('{yyyy}-{ww}');
    expect(formatSelect.selectedOptions[0].textContent).toContain('Jahr-Woche ohne Trennzeichen');
    // No custom-format input shown — a preset was matched.
    expect(document.querySelector('.api-config-range-format-custom')).toBeNull();
  });

  test('the live example preview echoes "Von" once it matches the auto-detected format', () => {
    confirmPennyCandidate();
    selectRangeForWeekPart();

    const fromInput = document.querySelector('.api-config-range-from');
    fromInput.value = '2026-35';
    fromInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.querySelector('.api-config-range-format-example').textContent).toBe('Beispiel: 2026-35');
  });

  test('switching to "Eigenes Format…" reveals a free-text input and the example follows it', () => {
    confirmPennyCandidate();
    selectRangeForWeekPart();

    const formatSelect = document.querySelector('.api-config-range-format-preset');
    formatSelect.value = 'custom';
    formatSelect.dispatchEvent(new Event('change', { bubbles: true }));

    const customInput = document.querySelector('.api-config-range-format-custom');
    expect(customInput).not.toBeNull();
    expect(document.querySelector('.api-config-range-format-example').textContent).toBe('Beispiel: (Format eingeben)');

    customInput.value = '{ww}/{yyyy}';
    customInput.dispatchEvent(new Event('change', { bubbles: true }));
    const fromInput = document.querySelector('.api-config-range-from');
    fromInput.value = '35/2026';
    fromInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.querySelector('.api-config-range-format-example').textContent).toBe('Beispiel: 35/2026');
  });

  test('changing Type re-detects the format against the new type\'s own presets', () => {
    confirmPennyCandidate();
    selectRangeForWeekPart(); // IsoWeek, auto-detected "{yyyy}-{ww}"

    const typeSelect = document.querySelector('.api-config-range-type');
    typeSelect.value = 'Date';
    typeSelect.dispatchEvent(new Event('change', { bubbles: true }));

    // "2026-35" matches no Date preset → falls back to Date's own
    // ISO-Standard, not IsoWeek's leftover format string.
    expect(document.querySelector('.api-config-range-format-preset').value).toBe('{yyyy}-{mm}-{dd}');
  });

  test('"Übernehmen" persists an ApiParameterSource with the non-default format — the actual fix for the reported bug', () => {
    confirmPennyCandidate();
    selectRangeForWeekPart();
    const fromInput = document.querySelector('.api-config-range-from');
    fromInput.value = '2026-35';
    fromInput.dispatchEvent(new Event('change', { bubbles: true }));
    const toInput = document.querySelector('.api-config-range-to');
    toInput.value = '2026-50';
    toInput.dispatchEvent(new Event('change', { bubbles: true }));

    document.getElementById('btn-api-config-confirm').click();

    const persistedConfig = chrome.storage.session.set.mock.calls.at(-1)[0].apiConfig;
    expect(persistedConfig.parameters).toContainEqual({
      name: 'KW',
      source: { kind: 'range', type: 'IsoWeek', from: '2026-35', to: '2026-50', format: '{yyyy}-{ww}' },
    });
  });
});
