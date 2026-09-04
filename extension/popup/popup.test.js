// Fixes the popup's language-detection default to German — none of the
// mocks below set up chrome.storage.local (the i18n module's stored-
// preference source), so every test in this file falls through to
// detectDefaultLanguage(navigator.language). Forcing it to German here
// means every pre-existing assertion below (written against the original
// hardcoded German copy) keeps working unchanged now that the same text
// comes from extension/i18n/de.json instead. Language-switching itself is
// covered separately (see "Language selector").
Object.defineProperty(window.navigator, 'language', { value: 'de-DE', configurable: true });

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
  buildApiGroupDraft, buildApiFieldDraft, resolveApiTreeNode, insertApiTreeNode, removeApiTreeNode,
  serializeApiTree, formatApiTreeNodeLabel, renderApiTree,
  renderApiCandidates, renderApiEntriesList,
  parseUrlTemplateParts, buildUrlTemplate, parseValueListInput,
  buildStaticListSource, buildDiscoverySource, buildRangeSource, buildApiHeaders, buildApiConfig,
  findUrlTemplateMatches, mergeValueListValues,
  variableUrlParts, apiConfigDraftHasAllSourcesChosen, renderApiConfigScreen,
  detectRangeFormat, findUrlPartValue, rangeFormatExample, sanitizeFileNameBase,
  addBrowserAction, removeBrowserAction, updateBrowserAction, serializeBrowserActions, renderBrowserActions,
  buildVerificationValues,
  frameBadgeHtml,
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
      scriptFileName: null,
      outputFileName: null,
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

  test('passes through scriptFileName/outputFileName as-is (companion sanitizes/defaults)', () => {
    const result = buildScrapingConfig('https://example.com', 'flat', [], [], null, 'my scraper!', 'result data');
    expect(result.scriptFileName).toBe('my scraper!');
    expect(result.outputFileName).toBe('result data');
  });

  test('defaults scriptFileName/outputFileName to null when not given', () => {
    const result = buildScrapingConfig('https://example.com', 'flat', []);
    expect(result.scriptFileName).toBeNull();
    expect(result.outputFileName).toBeNull();
  });

  // Issue #42, Phase 7
  test('includes framePath on a field when set, omits it when not', () => {
    const result = buildScrapingConfig('https://example.com', 'flat', [
      { name: 'Preis', selector: '.price', framePath: ['#price-widget'] },
      { name: 'Titel', selector: 'h1' },
    ]);
    expect(result.fields[0].framePath).toEqual(['#price-widget']);
    expect(result.fields[1]).not.toHaveProperty('framePath');
  });
});

// Issue #41/#42, Phase 5: engine/browserActions are mode-independent, so
// these are tested once rather than per mode (flat mode used as the
// representative case) — buildScrapingConfig's own doc comment explains why
// the omit/include behavior is important for existing-call backward-compat.
describe('buildScrapingConfig (engine / browserActions, Issue #41/#42 Phase 5)', () => {
  test('omits engine entirely when Static (the default) — byte-for-byte the same as before this existed', () => {
    const result = buildScrapingConfig('https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }]);
    expect(result.engine).toBeUndefined();
    expect(result.browserActions).toBeUndefined();
  });

  test('includes engine when Browser, even with no browserActions', () => {
    const result = buildScrapingConfig(
      'https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }], [], null, null, null, 'Browser',
    );
    expect(result.engine).toBe('Browser');
    expect(result.browserActions).toBeUndefined();
  });

  test('includes serialized browserActions alongside engine when Browser and non-empty', () => {
    const result = buildScrapingConfig(
      'https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }], [], null, null, null, 'Browser',
      [{ kind: 'click', selector: '#submit' }],
    );
    expect(result.engine).toBe('Browser');
    expect(result.browserActions).toEqual([{ kind: 'click', selector: '#submit' }]);
  });

  test('omits browserActions (and engine) when Static, even if actions were configured', () => {
    // Matches the popup's own UI behavior: switching back to Static hides
    // the browser-actions section without clearing it, so a user flipping
    // the toggle back and forth doesn't lose their work — but nothing
    // meaningless for the Static engine should ever reach the wire.
    const result = buildScrapingConfig(
      'https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }], [], null, null, null, 'Static',
      [{ kind: 'click', selector: '#submit' }],
    );
    expect(result.engine).toBeUndefined();
    expect(result.browserActions).toBeUndefined();
  });

  test('works the same way for container and api modes', () => {
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig('https://example.com', 'container', [], groups, null, null, null, 'Browser');
    expect(containerResult.engine).toBe('Browser');

    const apiResult = buildScrapingConfig('https://example.com', 'api', [], [], { fields: [] }, null, null, 'Browser');
    expect(apiResult.engine).toBe('Browser');
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
      scriptFileName: null,
      outputFileName: null,
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

    expect(result).toEqual({
      version: '1', url: 'https://example.com', api: apiConfig,
      scriptFileName: null, outputFileName: null,
    });
    expect(result.fields).toBeUndefined();
    expect(result.groups).toBeUndefined();
    expect(result.outputFormat).toBeUndefined();
  });
});

// ── sanitizeFileNameBase ─────────────────────────────────────────────────────
// Mirrors the companion's FileNameSanitizer (see popup.js) so the actual
// downloaded filename always matches what the generated script's own
// "# Run: python X.py" comment says, for the same raw input.

describe('sanitizeFileNameBase', () => {
  test('falls back for empty/whitespace-only input', () => {
    expect(sanitizeFileNameBase('', 'scraper')).toBe('scraper');
    expect(sanitizeFileNameBase('   ', 'scraper')).toBe('scraper');
    expect(sanitizeFileNameBase(null, 'scraper')).toBe('scraper');
    expect(sanitizeFileNameBase(undefined, 'scraper')).toBe('scraper');
  });

  test('replaces path separators, spaces and other unsafe characters', () => {
    expect(sanitizeFileNameBase('../../etc/passwd', 'output')).toBe('etc_passwd');
    expect(sanitizeFileNameBase('my scraper!', 'scraper')).toBe('my_scraper');
    expect(sanitizeFileNameBase('a"b\'c', 'output')).toBe('a_b_c');
  });

  test('keeps letters, digits, underscore and hyphen as-is', () => {
    expect(sanitizeFileNameBase('my-scraper_v2', 'scraper')).toBe('my-scraper_v2');
  });

  test('falls back when every character is invalid', () => {
    expect(sanitizeFileNameBase('///', 'output')).toBe('output');
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

  test('carries scriptFileName/outputFileName through into the wrapped config', () => {
    const result = buildConfigExport('https://example.com', 'flat', [], [], { version: '1.2.3' }, null, 'myscraper', 'result');
    expect(result.config.scriptFileName).toBe('myscraper');
    expect(result.config.outputFileName).toBe('result');
  });
});

// ── addField ─────────────────────────────────────────────────────────────────

describe('addField', () => {
  test('appends field with null attribute', () => {
    const result = addField([], 'Titel', 'h1');
    expect(result).toEqual([{ name: 'Titel', selector: 'h1', attribute: null, framePath: null }]);
  });

  // Issue #42, Phase 7
  test('appends field with framePath when given', () => {
    const result = addField([], 'Preis', 'h2', ['#price-widget']);
    expect(result).toEqual([{ name: 'Preis', selector: 'h2', attribute: null, framePath: ['#price-widget'] }]);
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

// ── Browser actions (Issue #41/#42, Phase 5) ─────────────────────────────────

describe('addBrowserAction', () => {
  test('appends a waitFor action with defaults', () => {
    expect(addBrowserAction([], 'waitFor')).toEqual([{ kind: 'waitFor', selector: '', timeoutMs: 5000 }]);
  });

  test('appends a fill action with defaults', () => {
    expect(addBrowserAction([], 'fill')).toEqual([{ kind: 'fill', selector: '', environmentVariableName: '' }]);
  });

  test('appends a click action with defaults', () => {
    expect(addBrowserAction([], 'click')).toEqual([{ kind: 'click', selector: '' }]);
  });

  test('appends a scroll action with defaults (Issue #41, Phase 6)', () => {
    expect(addBrowserAction([], 'scroll')).toEqual([
      { kind: 'scroll', containerSelector: '', loadMoreButtonSelector: '', maxIterations: 10, waitAfterMs: 1000 },
    ]);
  });

  test('does not mutate original array', () => {
    const actions = [{ kind: 'click', selector: '#a' }];
    addBrowserAction(actions, 'waitFor');
    expect(actions).toHaveLength(1);
  });
});

describe('removeBrowserAction', () => {
  const base = [
    { kind: 'fill', selector: '#user', environmentVariableName: 'SF_USER' },
    { kind: 'click', selector: '#submit' },
  ];

  test('removes the action at the given index', () => {
    const result = removeBrowserAction(base, 0);
    expect(result).toEqual([{ kind: 'click', selector: '#submit' }]);
  });

  test('does not mutate original array', () => {
    removeBrowserAction(base, 0);
    expect(base).toHaveLength(2);
  });
});

describe('updateBrowserAction', () => {
  test('patches only the action at the given index', () => {
    const actions = [{ kind: 'click', selector: '' }, { kind: 'waitFor', selector: '', timeoutMs: 5000 }];
    const result = updateBrowserAction(actions, 0, { selector: '#submit' });
    expect(result[0]).toEqual({ kind: 'click', selector: '#submit' });
    expect(result[1]).toEqual(actions[1]);
  });

  test('does not mutate original array', () => {
    const actions = [{ kind: 'click', selector: '' }];
    updateBrowserAction(actions, 0, { selector: '#submit' });
    expect(actions[0].selector).toBe('');
  });
});

describe('serializeBrowserActions', () => {
  test('picks only the wire-relevant fields per kind', () => {
    const actions = [
      { kind: 'waitFor', selector: '.welcome', timeoutMs: 3000 },
      { kind: 'fill', selector: '#user', environmentVariableName: 'SF_USER' },
      { kind: 'click', selector: '#submit' },
    ];
    expect(serializeBrowserActions(actions)).toEqual([
      { kind: 'waitFor', selector: '.welcome', timeoutMs: 3000 },
      { kind: 'fill', selector: '#user', environmentVariableName: 'SF_USER' },
      { kind: 'click', selector: '#submit' },
    ]);
  });

  test('drops UI-only extra fields not part of the wire shape', () => {
    const actions = [{ kind: 'click', selector: '#submit', someUiOnlyFlag: true }];
    expect(serializeBrowserActions(actions)).toEqual([{ kind: 'click', selector: '#submit' }]);
  });

  test('serializes a scroll action with both selectors set (Issue #41, Phase 6)', () => {
    const actions = [{ kind: 'scroll', containerSelector: '#list', loadMoreButtonSelector: '#more', maxIterations: 5, waitAfterMs: 500 }];
    expect(serializeBrowserActions(actions)).toEqual([
      { kind: 'scroll', containerSelector: '#list', loadMoreButtonSelector: '#more', maxIterations: 5, waitAfterMs: 500 },
    ]);
  });

  test('serializes an unpicked scroll selector as null, never empty string', () => {
    // ScrapingPlanValidator rejects a "set but blank" ContainerSelector/
    // LoadMoreButtonSelector — '' must never reach the wire.
    const actions = [{ kind: 'scroll', containerSelector: '', loadMoreButtonSelector: '', maxIterations: 10, waitAfterMs: 1000 }];
    const result = serializeBrowserActions(actions);
    expect(result[0].containerSelector).toBeNull();
    expect(result[0].loadMoreButtonSelector).toBeNull();
  });

  // Issue #42, Phase 7
  test('includes framePath on every kind when set, omits it entirely when null', () => {
    const framed = [
      { kind: 'waitFor', selector: '.welcome', timeoutMs: 3000, framePath: ['#login-widget'] },
      { kind: 'fill', selector: '#user', environmentVariableName: 'SF_USER', framePath: null },
      { kind: 'click', selector: '#submit', framePath: ['#login-widget'] },
      { kind: 'scroll', containerSelector: '#list', loadMoreButtonSelector: null, maxIterations: 5, waitAfterMs: 500, framePath: ['#feed-widget'] },
    ];
    const result = serializeBrowserActions(framed);
    expect(result[0].framePath).toEqual(['#login-widget']);
    expect(result[1]).not.toHaveProperty('framePath');
    expect(result[2].framePath).toEqual(['#login-widget']);
    expect(result[3].framePath).toEqual(['#feed-widget']);
  });
});

// Issue #43 — one-time Fill test values for the /generate verification trial
// run only, never persisted/logged/written into the generated script.
describe('buildVerificationValues', () => {
  test('collects a value for each fill action with a matching env-var-keyed test value', () => {
    const actions = [
      { kind: 'fill', selector: '#user', environmentVariableName: 'SF_USER' },
      { kind: 'fill', selector: '#pass', environmentVariableName: 'SF_PASS' },
    ];
    const result = buildVerificationValues(actions, { SF_USER: 'alice', SF_PASS: 's3cret' });
    expect(result).toEqual({ SF_USER: 'alice', SF_PASS: 's3cret' });
  });

  test('ignores non-fill actions', () => {
    const actions = [{ kind: 'click', selector: '#submit' }, { kind: 'waitFor', selector: '.welcome', timeoutMs: 5000 }];
    expect(buildVerificationValues(actions, { SF_USER: 'alice' })).toEqual({});
  });

  test('ignores a fill action with a blank env-var name', () => {
    const actions = [{ kind: 'fill', selector: '#user', environmentVariableName: '' }];
    expect(buildVerificationValues(actions, { '': 'alice' })).toEqual({});
  });

  test('ignores a blank/missing test value for an otherwise-matching env-var name', () => {
    const actions = [{ kind: 'fill', selector: '#user', environmentVariableName: 'SF_USER' }];
    expect(buildVerificationValues(actions, { SF_USER: '' })).toEqual({});
    expect(buildVerificationValues(actions, {})).toEqual({});
  });
});

// ── Container-Mode tree helpers ──────────────────────────────────────────────

describe('buildGroupNode / buildFieldNode', () => {
  test('buildGroupNode starts with empty children', () => {
    expect(buildGroupNode('Kategorie', 'section', true)).toEqual({
      kind: 'group', name: 'Kategorie', selector: 'section', repeating: true, children: [], framePath: null,
    });
  });

  test('buildFieldNode nulls attribute unless mode is attribute', () => {
    expect(buildFieldNode('Titel', 'h2', 'text', 'href')).toEqual({
      kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', attribute: null, framePath: null,
    });
    expect(buildFieldNode('Link', 'a', 'attribute', 'href')).toEqual({
      kind: 'field', name: 'Link', selector: 'a', mode: 'attribute', attribute: 'href', framePath: null,
    });
  });

  // Issue #42, Phase 7
  test('buildGroupNode / buildFieldNode carry a framePath when given', () => {
    expect(buildGroupNode('Kategorie', 'section', true, ['#price-widget']).framePath).toEqual(['#price-widget']);
    expect(buildFieldNode('Titel', 'h2', 'text', null, ['#price-widget', '#reviews-widget']).framePath)
      .toEqual(['#price-widget', '#reviews-widget']);
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

  // Issue #42, Phase 7
  test('includes framePath on both group and field nodes when set, omits it when null', () => {
    const groups = [
      {
        kind: 'group', name: 'Preisvergleich', selector: '#price-widget', repeating: false,
        framePath: ['#price-widget'],
        children: [
          { kind: 'field', name: 'Preis', selector: '.price', mode: 'text', attribute: null, framePath: ['#price-widget'] },
          { kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', attribute: null, framePath: null },
        ],
      },
    ];
    const [group] = serializeGroupTree(groups);
    expect(group.framePath).toEqual(['#price-widget']);
    expect(group.children[0].framePath).toEqual(['#price-widget']);
    expect(group.children[1]).not.toHaveProperty('framePath');
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

  // Issue #42, Phase 7
  test('shows an iframe badge only for a node with a framePath', () => {
    renderGroupTree([
      {
        kind: 'group', name: 'Preisvergleich', selector: '#price-widget', repeating: false,
        framePath: ['#price-widget'],
        children: [
          { kind: 'field', name: 'Preis', selector: '.price', mode: 'text', attribute: null, framePath: ['#price-widget'] },
          { kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', attribute: null, framePath: null },
        ],
      },
    ]);

    const groupRow = document.querySelector('[data-path="[0]"] > .group-tree-row');
    expect(groupRow.querySelector('.frame-badge').title).toContain('#price-widget');

    const framedFieldRow = document.querySelector('[data-path="[0,0]"] > .group-tree-row');
    expect(framedFieldRow.querySelector('.frame-badge')).not.toBeNull();

    const plainFieldRow = document.querySelector('[data-path="[0,1]"] > .group-tree-row');
    expect(plainFieldRow.querySelector('.frame-badge')).toBeNull();
  });
});

// ── API-Mode tree (ApiGroup/ApiField, Issue #54 Phase A4) ───────────────────
// Near-verbatim mirror of the Container-Mode tree tests above — same tree
// machinery, different field names (path instead of selector, no
// mode/attribute/repeating/framePath).

describe('resolveApiTreeNode / insertApiTreeNode / removeApiTreeNode', () => {
  const tree = () => [
    {
      kind: 'group', name: 'Kategorie', path: 'categories',
      children: [
        { kind: 'field', name: 'Name', path: 'name' },
      ],
    },
  ];

  test('resolveApiTreeNode returns null for a null/empty path', () => {
    expect(resolveApiTreeNode(tree(), null)).toBeNull();
    expect(resolveApiTreeNode(tree(), [])).toBeNull();
  });

  test('resolveApiTreeNode walks nested paths', () => {
    expect(resolveApiTreeNode(tree(), [0]).name).toBe('Kategorie');
    expect(resolveApiTreeNode(tree(), [0, 0]).name).toBe('Name');
  });

  test('insertApiTreeNode appends at root when parentPath is null', () => {
    const node = buildApiGroupDraft('Produkte', 'products');
    const result = insertApiTreeNode(tree(), null, node);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual(node);
  });

  test('insertApiTreeNode appends into a nested group', () => {
    const node = buildApiFieldDraft('Preis', 'price');
    const result = insertApiTreeNode(tree(), [0], node);
    expect(result[0].children).toHaveLength(2);
    expect(result[0].children[1]).toEqual(node);
  });

  test('insertApiTreeNode does not mutate the original tree', () => {
    const original = tree();
    insertApiTreeNode(original, [0], buildApiFieldDraft('X', 'x'));
    expect(original[0].children).toHaveLength(1);
  });

  test('removeApiTreeNode removes a root node', () => {
    expect(removeApiTreeNode(tree(), [0])).toEqual([]);
  });

  test('removeApiTreeNode removes a nested node', () => {
    const result = removeApiTreeNode(tree(), [0, 0]);
    expect(result[0].children).toEqual([]);
  });
});

describe('serializeApiTree', () => {
  test('strips internal `kind` and shapes group/field nodes for the wire, round-tripping a 3-level tree', () => {
    const groups = [
      {
        kind: 'group', name: 'Kategorie', path: 'categories',
        children: [
          { kind: 'field', name: 'Name', path: 'name' },
          {
            kind: 'group', name: 'Subkategorie', path: 'subcategories',
            children: [
              { kind: 'field', name: 'Name', path: 'name' },
              {
                kind: 'group', name: 'Produkt', path: 'products',
                children: [{ kind: 'field', name: 'Titel', path: 'title' }],
              },
            ],
          },
        ],
      },
    ];

    expect(serializeApiTree(groups)).toEqual([
      {
        name: 'Kategorie', path: 'categories',
        children: [
          { name: 'Name', path: 'name' },
          {
            name: 'Subkategorie', path: 'subcategories',
            children: [
              { name: 'Name', path: 'name' },
              { name: 'Produkt', path: 'products', children: [{ name: 'Titel', path: 'title' }] },
            ],
          },
        ],
      },
    ]);
  });

  test('a group with an empty path (array-of-arrays, see ApiGroup.Path) round-trips unchanged', () => {
    const groups = [{ kind: 'group', name: 'Zeile', path: '', children: [{ kind: 'field', name: 'Titel', path: 'title' }] }];
    expect(serializeApiTree(groups)[0].path).toBe('');
  });

  test('a field node never has a `children` key', () => {
    const groups = [{ kind: 'field', name: 'Titel', path: 'title' }];
    expect(serializeApiTree(groups)[0]).not.toHaveProperty('children');
  });
});

describe('formatApiTreeNodeLabel', () => {
  test('shows the name and path together', () => {
    expect(formatApiTreeNodeLabel(buildApiGroupDraft('Kategorie', 'categories'))).toBe('Kategorie (categories)');
    expect(formatApiTreeNodeLabel(buildApiFieldDraft('Titel', 'title'))).toBe('Titel (title)');
  });

  test('omits the parens entirely for an empty path (array-of-arrays group)', () => {
    expect(formatApiTreeNodeLabel(buildApiGroupDraft('Zeile', ''))).toBe('Zeile');
  });
});

describe('renderApiTree', () => {
  beforeEach(() => {
    document.body.innerHTML = '<ul id="api-tree-root"></ul>';
  });

  test('renders nested groups and fields with add/remove buttons', () => {
    renderApiTree([
      {
        kind: 'group', name: 'Kategorie', path: 'categories',
        children: [{ kind: 'field', name: 'Titel', path: 'name' }],
      },
    ]);

    const nodes = document.querySelectorAll('.api-tree-node');
    expect(nodes).toHaveLength(2);

    const groupRow = document.querySelector('[data-path="[0]"] > .api-tree-row');
    expect(groupRow.textContent).toContain('Kategorie (categories)');
    expect(groupRow.querySelector('.btn-add-api-subgroup')).not.toBeNull();
    expect(groupRow.querySelector('.btn-add-api-subfield')).not.toBeNull();
    expect(groupRow.querySelector('.btn-remove-api-node')).not.toBeNull();

    const fieldRow = document.querySelector('[data-path="[0,0]"] > .api-tree-row');
    expect(fieldRow.textContent).toContain('Titel (name)');
    expect(fieldRow.querySelector('.btn-add-api-subgroup')).toBeNull(); // fields can't have children
    expect(fieldRow.querySelector('.btn-remove-api-node')).not.toBeNull();
  });

  test('a 3-level tree renders with correct nesting/indentation', () => {
    renderApiTree([
      {
        kind: 'group', name: 'Kategorie', path: 'categories',
        children: [
          {
            kind: 'group', name: 'Subkategorie', path: 'subcategories',
            children: [
              {
                kind: 'group', name: 'Produkt', path: 'products',
                children: [{ kind: 'field', name: 'Titel', path: 'title' }],
              },
            ],
          },
        ],
      },
    ]);

    expect(document.querySelectorAll('.api-tree-node')).toHaveLength(4);
    const leafRow = document.querySelector('[data-path="[0,0,0,0]"] > .api-tree-row');
    expect(leafRow.textContent).toContain('Titel (title)');
    // Each level is indented 12px further than its parent (depth * 12px).
    const rootRow = document.querySelector('[data-path="[0]"] > .api-tree-row');
    expect(rootRow.style.paddingLeft).toBe('0px');
    expect(leafRow.style.paddingLeft).toBe('36px');
  });

  test('groups start expanded, unlike the DOM tree view', () => {
    renderApiTree([
      {
        kind: 'group', name: 'Kategorie', path: 'categories',
        children: [{ kind: 'field', name: 'Titel', path: 'name' }],
      },
    ]);
    const childUl = document.querySelector('[data-path="[0]"] > .api-tree-children');
    expect(childUl.classList.contains('hidden')).toBe(false);
  });
});

// ── escapeHtml ────────────────────────────────────────────────────────────────

// Issue #42, Phase 7
describe('frameBadgeHtml', () => {
  test('returns empty string for null/empty framePath', () => {
    expect(frameBadgeHtml(null)).toBe('');
    expect(frameBadgeHtml([])).toBe('');
  });

  test('renders a badge with the joined path in the title', () => {
    const html = frameBadgeHtml(['#price-widget', '#reviews-widget']);
    expect(html).toContain('frame-badge');
    expect(html).toContain('#price-widget &gt; #reviews-widget');
  });
});

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

  // Issue #42, Phase 7
  test('shows an iframe badge only for a field with a framePath', () => {
    renderFields([
      { name: 'Preis', selector: '.price', attribute: null, framePath: ['#price-widget'] },
      { name: 'Titel', selector: 'h1', attribute: null, framePath: null },
    ]);

    const rows = document.querySelectorAll('.field-row');
    expect(rows[0].querySelector('.frame-badge')).not.toBeNull();
    expect(rows[0].querySelector('.frame-badge').title).toContain('#price-widget');
    expect(rows[1].querySelector('.frame-badge')).toBeNull();
  });
});

// Issue #43 — the test-value input only appears once a fill action's
// env-var name is actually set (that's the join key sent to /generate).
describe('renderBrowserActions — Fill test-value row', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="browser-actions-list"></div>';
  });

  test('renders a test-value input for a fill action with a non-blank env-var name', () => {
    renderBrowserActions([{ kind: 'fill', selector: '#user', environmentVariableName: 'SF_USER' }], { SF_USER: 'alice' });

    const input = document.querySelector('.browser-action-test-value');
    expect(input).not.toBeNull();
    expect(input.dataset.envName).toBe('SF_USER');
    expect(input.value).toBe('alice');
    expect(input.type).toBe('password');
  });

  test('does not render a test-value input for a fill action with a blank env-var name', () => {
    renderBrowserActions([{ kind: 'fill', selector: '#user', environmentVariableName: '' }], {});
    expect(document.querySelector('.browser-action-test-value')).toBeNull();
  });

  test('does not render a test-value input for non-fill actions', () => {
    renderBrowserActions([{ kind: 'click', selector: '#submit' }], {});
    expect(document.querySelector('.browser-action-test-value')).toBeNull();
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

  test('renders a "select all" button alongside the sibling chips, initially labeled to select', () => {
    renderApiCandidates({
      target: 'Suppe',
      candidates: [{
        url: 'https://example.com/api', method: 'GET', path: 'items[0].name', value: 'Suppe',
        siblings: [{ name: 'price', path: 'items[0].price', value: 3.5 }, { name: 'unit', path: 'items[0].unit', value: 'kg' }],
      }],
    });

    const selectAllBtn = document.querySelector('.api-sibling-select-all');
    expect(selectAllBtn).not.toBeNull();
    expect(selectAllBtn.textContent).toBe('Alle auswählen');
  });

  test('no select-all button when a candidate has no siblings', () => {
    renderApiCandidates({
      target: 'Suppe',
      candidates: [{ url: 'https://example.com/api', method: 'GET', path: 'items[0].name', value: 'Suppe', siblings: [] }],
    });
    expect(document.querySelector('.api-sibling-select-all')).toBeNull();
  });
});

describe('renderApiEntriesList (recorded-endpoints viewer)', () => {
  beforeEach(() => {
    document.body.innerHTML = `<ul id="api-entries-list"></ul>`;
  });

  test('shows an empty-state message when nothing was recorded', () => {
    renderApiEntriesList([]);
    expect(document.querySelector('.api-candidates-empty')).not.toBeNull();
  });

  test('treats a missing/null entries list the same as empty', () => {
    renderApiEntriesList(null);
    expect(document.querySelector('.api-candidates-empty')).not.toBeNull();
  });

  test('renders one row per entry with method, status and URL, plus content type when present', () => {
    renderApiEntriesList([
      { url: 'https://example.com/api/items', method: 'GET', status: 200, contentType: 'application/json' },
      { url: 'https://example.com/img.png', method: 'GET', status: 200, contentType: 'image/png', bodySkipped: true },
    ]);

    const rows = document.querySelectorAll('.api-candidate');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.api-candidate-url').textContent).toBe('GET 200 https://example.com/api/items');
    expect(rows[0].querySelector('.api-candidate-path').textContent).toBe('application/json');
    // The status is always known (read off the response before the
    // body-skip decision, see api-capture.js) — bodySkipped only affects
    // whether a body was captured, not whether the row shows a status.
    expect(rows[1].querySelector('.api-candidate-url').textContent).toBe('GET 200 https://example.com/img.png');
  });

  test('omits the content-type line entirely when none was recorded', () => {
    renderApiEntriesList([{ url: 'https://example.com/api', method: 'GET', status: 200, contentType: null }]);
    expect(document.querySelector('.api-candidate-path')).toBeNull();
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

  test('renders confirmed fields with an editable name and a read-only path', () => {
    renderApiConfigScreen(baseDraft(), null);
    const row = document.querySelector('#api-config-fields .api-config-field-row');
    expect(row.querySelector('.api-config-field-name').value).toBe('Titel');
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
    expect(formatLogSection('Empty', [])).toBe('## Empty\n(no entries)\n');
    expect(formatLogSection('Missing', null)).toBe('## Missing\n(no entries)\n');
  });
});

// buildGithubIssueUrl's fixed strings (title/body copy) are always English,
// independent of the popup's selected UI language — see CLAUDE.md's
// Language policy: bug reports are a maintainer-facing GitHub artifact, not
// conversational UI a multilingual end user reads.
describe('buildGithubIssueUrl', () => {
  test("points at the repo's new-issue page", () => {
    const url = buildGithubIssueUrl('some report text');
    expect(url.startsWith('https://github.com/Aventinis/Scraping-Factory/issues/new?')).toBe(true);
  });

  test('uses the last reported error as the title when set', () => {
    setLastError('HTTP 500', 'Script generation');
    const url = buildGithubIssueUrl('report');
    expect(url).toContain(`title=${encodeURIComponent('Error: HTTP 500')}`);
  });

  test('embeds the full report body when short', () => {
    const url = buildGithubIssueUrl('a short report');
    const body = decodeURIComponent(url.split('body=')[1]);
    expect(body).toContain('a short report');
    expect(body).not.toContain('truncated');
  });

  test('truncates and adds a note when the report is very long', () => {
    const longReport = 'x'.repeat(10000);
    const url = buildGithubIssueUrl(longReport);
    const body = decodeURIComponent(url.split('body=')[1]);
    expect(body).toContain('truncated');
    expect(body.length).toBeLessThan(longReport.length);
  });

  test('never exceeds GitHub\'s practical URL length limit, even for excerpt-hostile content', () => {
    // Lots of characters that balloon under percent-encoding (quotes/braces/
    // newlines, as real JSON log data would contain) — the raw-character
    // excerpt limit alone doesn't bound the *encoded* URL length.
    const hostileReport = '{"a":"\n"}'.repeat(2000);
    const url = buildGithubIssueUrl(hostileReport);
    expect(url.length).toBeLessThanOrEqual(8000);
    expect(url.startsWith('https://github.com/Aventinis/Scraping-Factory/issues/new')).toBe(true);
  });

  test('drops the log excerpt and points at the manual attachment when still too long', () => {
    const hostileReport = '{"a":"\n"}'.repeat(2000);
    const url = buildGithubIssueUrl(hostileReport);
    const body = decodeURIComponent(url.split('body=')[1]);
    expect(body).toContain('too long to prefill');
    expect(body).not.toContain('<details>');
  });

  test('falls back to a fully blank issue when even the title alone is too long', () => {
    setLastError('E'.repeat(9000), 'Script generation');
    const url = buildGithubIssueUrl('short report');
    expect(url).toBe('https://github.com/Aventinis/Scraping-Factory/issues/new');
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

// A 400 is ScrapingPlanValidator/the /generate endpoint itself rejecting a
// structurally invalid config (bad URL, mutually exclusive Fields/Groups/
// Api, a FramePath without Engine=Browser, ...) — a deterministic,
// pre-execution rejection of the current configuration, never a companion
// or generated-script malfunction. Unlike the 422 case above, this must
// NOT invite a bug report — that would just fill GitHub issues with
// non-bugs (see the "Static engine + a framed field/action" case that
// prompted this).
describe('generate() surfaces a 400 config rejection without inviting a bug report', () => {
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
            fields: [{ name: 'Preis', selector: '.price', attribute: null, framePath: ['#widget'] }],
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
          status: 400,
          json: () => Promise.resolve({
            error: 'FramePath ist nur mit Engine "Browser" zulässig.',
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, fields restored from storage
  });

  test('shows a toast with the rejection reason but keeps the "Report bug" button hidden', async () => {
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const toast = document.getElementById('error-toast');
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('error-toast-message').textContent).toContain('FramePath ist nur mit Engine');
    expect(document.getElementById('btn-report-bug-toast').classList.contains('hidden')).toBe(true);
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

  // Issue #42, Phase 7: a framed container/field shows the iframe badge in
  // the tree and carries framePath through to the wire format.
  test('a root container picked inside an iframe shows the iframe badge and serializes with framePath', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Preisvergleich';
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '#price-box', framePath: ['#price-widget'] });
    await flushMicrotasks();

    const badge = document.querySelector('#group-tree-root .frame-badge');
    expect(badge).not.toBeNull();
    expect(badge.title).toContain('#price-widget');

    expect(serializeGroupTree([{
      kind: 'group', name: 'Preisvergleich', selector: '#price-box', repeating: false,
      children: [], framePath: ['#price-widget'],
    }])[0].framePath).toEqual(['#price-widget']);
  });

  test('a root container picked at the top level shows no iframe badge', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();

    expect(document.querySelector('#group-tree-root .frame-badge')).toBeNull();
  });
});

// ── Engine + browser actions integration (Issue #41/#42, Phase 5) ───────────
// Mode-independent (see buildScrapingConfig's doc comment) — mirrors the
// Container-Mode integration block's DOM-mocking pattern above, but the
// engine toggle/browser-actions list is never gated behind a mode switch.

describe('Engine + browser actions integration', () => {
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
        </div>
        <div>
          <button id="btn-engine-static" class="mode-btn active"></button>
          <button id="btn-engine-browser" class="mode-btn"></button>
          <div id="browser-actions-section" class="hidden">
            <div id="browser-actions-list"></div>
            <button id="btn-add-action-wait"></button>
            <button id="btn-add-action-fill"></button>
            <button id="btn-add-action-click"></button>
            <button id="btn-add-action-scroll"></button>
          </div>
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

  test('Browser engine reveals the browser-actions section; Static hides it again', () => {
    expect(document.getElementById('browser-actions-section').classList.contains('hidden')).toBe(true);

    document.getElementById('btn-engine-browser').click();
    expect(document.getElementById('browser-actions-section').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('btn-engine-browser').classList.contains('active')).toBe(true);
    expect(document.getElementById('btn-engine-static').classList.contains('active')).toBe(false);

    document.getElementById('btn-engine-static').click();
    expect(document.getElementById('browser-actions-section').classList.contains('hidden')).toBe(true);
  });

  test('adding each action kind renders the right card, in order', () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-wait').click();
    document.getElementById('btn-add-action-fill').click();
    document.getElementById('btn-add-action-click').click();
    document.getElementById('btn-add-action-scroll').click();

    const cards = document.querySelectorAll('.browser-action-card');
    expect(cards).toHaveLength(4);
    expect(cards[0].querySelector('.browser-action-timeout')).not.toBeNull();
    expect(cards[1].querySelector('.browser-action-env-name')).not.toBeNull();
    expect(cards[2].querySelector('.browser-action-timeout')).toBeNull();
    expect(cards[2].querySelector('.browser-action-env-name')).toBeNull();
    expect(cards[3].querySelectorAll('.btn-pick-action-selector')).toHaveLength(2);
    expect(cards[3].querySelector('.browser-action-max-iterations')).not.toBeNull();
    expect(cards[3].querySelector('.browser-action-wait-after-ms')).not.toBeNull();
  });

  test('a scroll card\'s two pick buttons target containerSelector/loadMoreButtonSelector independently', async () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-scroll').click();

    // Re-query after every pick — each ELEMENT_SELECTED round re-renders
    // #browser-actions-list from scratch, so a NodeList captured before a
    // prior round is a snapshot of now-detached nodes (the exact "stale
    // element handle" pitfall documented in the Phase 5 manual verification
    // notes, here as a real jsdom analogue).
    let pickButtons = document.querySelectorAll('.btn-pick-action-selector');
    expect(pickButtons[0].dataset.field).toBe('containerSelector');
    expect(pickButtons[1].dataset.field).toBe('loadMoreButtonSelector');

    pickButtons[1].click(); // pick the load-more button first, on purpose
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '#load-more' });
    await flushMicrotasks();

    pickButtons = document.querySelectorAll('.btn-pick-action-selector');
    pickButtons[0].click(); // then the container — must not overwrite the first pick
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '#list' });
    await flushMicrotasks();

    const selectorTexts = [...document.querySelectorAll('.browser-action-selector-row .field-selector')].map(el => el.textContent);
    expect(selectorTexts).toEqual(['#list', '#load-more']);
  });

  test('editing a scroll action\'s maxIterations/waitAfterMs persists them into state', () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-scroll').click();

    const maxIterationsInput = document.querySelector('.browser-action-max-iterations');
    maxIterationsInput.value = '20';
    maxIterationsInput.dispatchEvent(new Event('change', { bubbles: true }));

    const waitAfterMsInput = document.querySelector('.browser-action-wait-after-ms');
    waitAfterMsInput.value = '2500';
    waitAfterMsInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.querySelector('.browser-action-max-iterations').value).toBe('20');
    expect(document.querySelector('.browser-action-wait-after-ms').value).toBe('2500');
  });

  test('removing an action drops only that card', () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-wait').click();
    document.getElementById('btn-add-action-click').click();

    document.querySelectorAll('.btn-remove-action')[0].click();

    const cards = document.querySelectorAll('.browser-action-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].querySelector('.browser-action-timeout')).toBeNull(); // the click action remains
  });

  test('editing a Fill action\'s environment variable name persists it into state', () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-fill').click();

    const envInput = document.querySelector('.browser-action-env-name');
    envInput.value = 'SF_USERNAME';
    envInput.dispatchEvent(new Event('change', { bubbles: true }));

    // Re-render (triggered by the change handler's setState) must not lose it.
    expect(document.querySelector('.browser-action-env-name').value).toBe('SF_USERNAME');
  });

  // Issue #43
  test('setting a Fill action\'s env-var name reveals its test-value input', () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-fill').click();

    expect(document.querySelector('.browser-action-test-value')).toBeNull();

    const envInput = document.querySelector('.browser-action-env-name');
    envInput.value = 'SF_USERNAME';
    envInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.querySelector('.browser-action-test-value')).not.toBeNull();
  });

  // Issue #43: fillTestValues must never survive a popup close/reopen — the
  // change handler uses patchState (which never calls persistState), unlike
  // every other browser-action field here, which uses setState.
  test('typing a Fill test value updates the input but is never written to session storage', () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-fill').click();
    const envInput = document.querySelector('.browser-action-env-name');
    envInput.value = 'SF_USERNAME';
    envInput.dispatchEvent(new Event('change', { bubbles: true }));

    chrome.storage.session.set.mockClear();
    const testValueInput = document.querySelector('.browser-action-test-value');
    testValueInput.value = 'alice';
    testValueInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.querySelector('.browser-action-test-value').value).toBe('alice');
    expect(chrome.storage.session.set).not.toHaveBeenCalled();
  });

  test('picking an element for an action selector: START_SELECTION, then the result is written straight into that action — no modal', async () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-click').click();

    document.querySelector('.btn-pick-action-selector').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'START_SELECTION' });
    expect(document.getElementById('screen-selecting').classList.contains('hidden')).toBe(false);

    capturedListener({ type: 'ELEMENT_SELECTED', selector: '#submit' });
    await flushMicrotasks();

    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(false);
    const selectorText = document.querySelector('.browser-action-selector-row .field-selector');
    expect(selectorText.textContent).toBe('#submit');
  });

  // Issue #42, Phase 7: a click landing inside an iframe reports a framePath
  // alongside the selector — it's written straight into the action (like the
  // selector itself) and surfaced as a badge on the action card.
  test('a framed action selector shows the iframe badge and carries framePath onto the action', async () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-click').click();

    document.querySelector('.btn-pick-action-selector').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '#submit', framePath: ['#login-widget'] });
    await flushMicrotasks();

    const badge = document.querySelector('.browser-action-card .frame-badge');
    expect(badge).not.toBeNull();
    expect(badge.title).toContain('#login-widget');

    expect(serializeBrowserActions([{ kind: 'click', selector: '#submit', framePath: ['#login-widget'] }]))
      .toEqual([{ kind: 'click', selector: '#submit', framePath: ['#login-widget'] }]);
  });

  test('a top-level (unframed) action selector shows no iframe badge', async () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-click').click();

    document.querySelector('.btn-pick-action-selector').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '#submit' });
    await flushMicrotasks();

    expect(document.querySelector('.browser-action-card .frame-badge')).toBeNull();
  });

  test('a full login flow (fill, fill, click, wait) is sent to /generate with engine and browserActions', async () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-fill').click();
    document.getElementById('btn-add-action-fill').click();
    document.getElementById('btn-add-action-click').click();
    document.getElementById('btn-add-action-wait').click();

    const pickButtons = () => document.querySelectorAll('.btn-pick-action-selector');
    const envInputs = () => document.querySelectorAll('.browser-action-env-name');

    pickButtons()[0].click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '#username' });
    await flushMicrotasks();
    envInputs()[0].value = 'SF_USERNAME';
    envInputs()[0].dispatchEvent(new Event('change', { bubbles: true }));

    pickButtons()[1].click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '#password' });
    await flushMicrotasks();
    envInputs()[1].value = 'SF_PASSWORD';
    envInputs()[1].dispatchEvent(new Event('change', { bubbles: true }));

    pickButtons()[2].click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '#submit' });
    await flushMicrotasks();

    pickButtons()[3].click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.welcome' });
    await flushMicrotasks();

    // hasConfig (gating btn-generate) only looks at fields/groups/apiConfig,
    // none of which this test cares about — only the request body's
    // engine/browserActions shape — so the disabled gate is bypassed
    // directly rather than adding an unrelated flat field just to satisfy it.
    document.getElementById('btn-generate').disabled = false;
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const [, options] = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/generate'));
    const body = JSON.parse(options.body);
    expect(body.engine).toBe('Browser');
    expect(body.browserActions).toEqual([
      { kind: 'fill', selector: '#username', environmentVariableName: 'SF_USERNAME' },
      { kind: 'fill', selector: '#password', environmentVariableName: 'SF_PASSWORD' },
      { kind: 'click', selector: '#submit' },
      { kind: 'waitFor', selector: '.welcome', timeoutMs: 5000 },
    ]);
    // Issue #43: no test values were typed in this test, so nothing is sent —
    // matches the gap the feature closes without ever forcing an empty key.
    expect(body.verificationValues).toBeUndefined();
  });

  // Issue #43
  test('typed Fill test values are sent to /generate as verificationValues, keyed by env-var name', async () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-fill').click();
    document.getElementById('btn-add-action-fill').click();

    const envInputs = () => document.querySelectorAll('.browser-action-env-name');
    envInputs()[0].value = 'SF_USERNAME';
    envInputs()[0].dispatchEvent(new Event('change', { bubbles: true }));
    envInputs()[1].value = 'SF_PASSWORD';
    envInputs()[1].dispatchEvent(new Event('change', { bubbles: true }));

    const testValueInputs = () => document.querySelectorAll('.browser-action-test-value');
    testValueInputs()[0].value = 'alice';
    testValueInputs()[0].dispatchEvent(new Event('change', { bubbles: true }));
    testValueInputs()[1].value = 's3cret';
    testValueInputs()[1].dispatchEvent(new Event('change', { bubbles: true }));

    document.getElementById('btn-generate').disabled = false;
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const [, options] = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/generate'));
    const body = JSON.parse(options.body);
    expect(body.verificationValues).toEqual({ SF_USERNAME: 'alice', SF_PASSWORD: 's3cret' });
    // The logged request body must stay clean — never carries the test values.
    expect(body.engine).toBe('Browser');
  });

  test('a scroll action with only the load-more button picked is sent with containerSelector: null', async () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-scroll').click();

    const pickButtons = document.querySelectorAll('.btn-pick-action-selector');
    pickButtons[1].click(); // loadMoreButtonSelector only — containerSelector stays unset
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '#load-more' });
    await flushMicrotasks();

    const maxIterationsInput = document.querySelector('.browser-action-max-iterations');
    maxIterationsInput.value = '6';
    maxIterationsInput.dispatchEvent(new Event('change', { bubbles: true }));

    document.getElementById('btn-generate').disabled = false;
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const [, options] = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/generate'));
    const body = JSON.parse(options.body);
    expect(body.browserActions).toEqual([
      { kind: 'scroll', containerSelector: null, loadMoreButtonSelector: '#load-more', maxIterations: 6, waitAfterMs: 1000 },
    ]);
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
      scriptFileName: null,
      outputFileName: null,
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
      scriptFileName: null,
      outputFileName: null,
    });
  });
});

describe('output settings (script/output filename)', () => {
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
        <div id="api-mode-section" class="hidden"></div>
        <input type="text" id="input-script-filename" />
        <input type="text" id="input-output-filename" />
        <span id="output-filename-ext"></span>
        <button id="btn-generate" disabled></button>
        <button id="btn-export-config" disabled></button>
      </section>
      <section id="screen-generating" class="hidden"></section>
      <section id="screen-done" class="hidden">
        <button id="btn-download"></button>
      </section>
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
            url: 'https://example.com',
          }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true }); // health check
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = jest.fn();

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, fields restored from storage
  });

  test('typing into the script/output filename inputs persists them to session storage', () => {
    const scriptInput = document.getElementById('input-script-filename');
    scriptInput.value = 'mein-scraper';
    scriptInput.dispatchEvent(new Event('input'));

    const outputInput = document.getElementById('input-output-filename');
    outputInput.value = 'ergebnisse';
    outputInput.dispatchEvent(new Event('input'));

    expect(global.chrome.storage.session.set).toHaveBeenCalledWith(
      expect.objectContaining({ scriptFileName: 'mein-scraper', outputFileName: 'ergebnisse' }),
    );
  });

  test('the output extension hint switches between .csv and .xml depending on mode', () => {
    const ext = document.getElementById('output-filename-ext');
    expect(ext.textContent).toBe('.csv');

    document.getElementById('btn-mode-container').click();
    expect(ext.textContent).toBe('.xml');

    document.getElementById('btn-mode-flat').click();
    expect(ext.textContent).toBe('.csv');
  });

  test('generate() sends the configured script/output filenames to /generate', async () => {
    document.getElementById('input-script-filename').value = 'mein-scraper';
    document.getElementById('input-script-filename').dispatchEvent(new Event('input'));
    document.getElementById('input-output-filename').value = 'ergebnisse';
    document.getElementById('input-output-filename').dispatchEvent(new Event('input'));

    global.fetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('# script') });
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const generateCall = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/generate'));
    const body = JSON.parse(generateCall[1].body);
    expect(body.scriptFileName).toBe('mein-scraper');
    expect(body.outputFileName).toBe('ergebnisse');
  });

  test('the downloaded file uses the sanitized script filename', async () => {
    document.getElementById('input-script-filename').value = 'my scraper!';
    document.getElementById('input-script-filename').dispatchEvent(new Event('input'));

    global.fetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('# script') });
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const appendSpy = jest.spyOn(document.body, 'appendChild');
    document.getElementById('btn-download').click();

    const anchor = appendSpy.mock.calls[0][0];
    expect(anchor.download).toBe('my_scraper.py');
    appendSpy.mockRestore();
  });

  test('the downloaded file falls back to "scraper.py" when no script name was typed', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('# script') });
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const appendSpy = jest.spyOn(document.body, 'appendChild');
    document.getElementById('btn-download').click();

    const anchor = appendSpy.mock.calls[0][0];
    expect(anchor.download).toBe('scraper.py');
    appendSpy.mockRestore();
  });

  test('the done-screen download button label shows the configured (sanitized) script name', async () => {
    document.getElementById('input-script-filename').value = 'mein scraper!';
    document.getElementById('input-script-filename').dispatchEvent(new Event('input'));

    global.fetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('# script') });
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    expect(document.getElementById('btn-download').textContent).toBe('mein_scraper.py herunterladen');
  });

  test('the done-screen download button label falls back to "scraper.py" when no script name was typed', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('# script') });
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    expect(document.getElementById('btn-download').textContent).toBe('scraper.py herunterladen');
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

describe('robots.txt check (btn-check-robots)', () => {
  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <button id="btn-check-robots"></button>
        <p id="robots-txt-result" class="hidden"></p>
      </section>
      <div id="error-toast" class="hidden">
        <span id="error-toast-message"></span>
        <button id="btn-report-bug-toast" class="hidden"></button>
      </div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: () => {} },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com/produkte' }])) },
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

  test('starts out hidden with the default label', () => {
    const result = document.getElementById('robots-txt-result');
    expect(result.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('btn-check-robots').textContent).toBe('robots.txt prüfen');
  });

  test('clicking sends CHECK_ROBOTS_TXT and shows a disallowed result in red', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({
      ok: true, robotsUrl: 'https://example.com/robots.txt', path: '/produkte',
      notFound: false, allowed: false, matchedRule: { type: 'disallow', pattern: '/produkte' },
    });

    document.getElementById('btn-check-robots').click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'CHECK_ROBOTS_TXT' });
    expect(document.getElementById('btn-check-robots').textContent).toBe('Prüfe robots.txt…');
    expect(document.getElementById('btn-check-robots').disabled).toBe(true);

    await flushMicrotasks();

    const result = document.getElementById('robots-txt-result');
    expect(result.classList.contains('hidden')).toBe(false);
    expect(result.classList.contains('robots-txt-disallowed')).toBe(true);
    expect(result.textContent).toContain('Verboten');
    expect(result.textContent).toContain('/produkte');
    expect(document.getElementById('btn-check-robots').disabled).toBe(false);
  });

  test('an allowed result is shown in green', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({
      ok: true, robotsUrl: 'https://example.com/robots.txt', path: '/produkte',
      notFound: false, allowed: true, matchedRule: null,
    });

    document.getElementById('btn-check-robots').click();
    await flushMicrotasks();

    const result = document.getElementById('robots-txt-result');
    expect(result.classList.contains('robots-txt-allowed')).toBe(true);
    expect(result.textContent).toContain('Erlaubt');
  });

  test('no robots.txt found (404) is shown as allowed', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({
      ok: true, robotsUrl: 'https://example.com/robots.txt', path: '/produkte',
      notFound: true, allowed: true, matchedRule: null,
    });

    document.getElementById('btn-check-robots').click();
    await flushMicrotasks();

    const result = document.getElementById('robots-txt-result');
    expect(result.classList.contains('robots-txt-allowed')).toBe(true);
    expect(result.textContent).toContain('Keine robots.txt gefunden');
  });

  test('a failed check is shown in gray with the error message', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'Keine aktive Seite gefunden.' });

    document.getElementById('btn-check-robots').click();
    await flushMicrotasks();

    const result = document.getElementById('robots-txt-result');
    expect(result.classList.contains('robots-txt-unknown')).toBe(true);
    expect(result.textContent).toContain('Keine aktive Seite gefunden.');
  });

  test('a rejected sendMessage is handled the same way as an {ok:false} result', async () => {
    chrome.runtime.sendMessage.mockRejectedValue(new Error('No content script'));

    document.getElementById('btn-check-robots').click();
    await flushMicrotasks();

    const result = document.getElementById('robots-txt-result');
    expect(result.classList.contains('robots-txt-unknown')).toBe(true);
    expect(result.textContent).toContain('No content script');
    expect(document.getElementById('btn-check-robots').disabled).toBe(false);
  });
});

describe('Language selector (lang-select)', () => {
  // initI18n() adds a few extra microtask hops in front of the rest of
  // init()'s async chain (storage read + checkCompanion's fetch) compared
  // to describes elsewhere in this file — a few more iterations than the
  // usual 5 keeps this reliably past STATES.IDLE without depending on
  // exact tick counts.
  const flushMicrotasks = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  function baseHtml() {
    return `
      <div id="lang-switcher">
        <select id="lang-select">
          <option value="de">Deutsch</option>
          <option value="en">English</option>
          <option value="es">Español</option>
        </select>
      </div>
      <section id="screen-idle" class="hidden">
        <div class="row-label" data-i18n="idle.urlLabel"></div>
        <div id="url-display"></div>
        <div class="mode-toggle">
          <button id="btn-mode-flat" class="mode-btn active" data-i18n="idle.modeFlat"></button>
          <button id="btn-mode-container" class="mode-btn" data-i18n="idle.modeContainer"></button>
        </div>
        <div id="flat-mode-section">
          <div id="fields-list"></div>
          <button id="btn-add-field" data-i18n="idle.addFieldBtn"></button>
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
  }

  function baseChromeMock(storageLocalGet) {
    return {
      runtime: {
        onMessage: { addListener: () => {} },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue({ fields: [{ name: 'Titel', selector: 'h1', attribute: null }] }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
        local: {
          get: jest.fn().mockResolvedValue(storageLocalGet || {}),
          set: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
  }

  afterEach(() => {
    Object.defineProperty(window.navigator, 'language', { value: 'de-DE', configurable: true });
  });

  test('applies the detected browser language on init, with no stored preference', async () => {
    jest.resetModules();
    document.body.innerHTML = baseHtml();
    global.chrome = baseChromeMock();
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flushMicrotasks();

    expect(document.getElementById('lang-select').value).toBe('de');
    expect(document.getElementById('btn-mode-flat').textContent).toBe('Felder (flach)');
    expect(document.documentElement.lang).toBe('de');
  });

  test('an unsupported browser language falls back to English', async () => {
    Object.defineProperty(window.navigator, 'language', { value: 'fr-FR', configurable: true });
    jest.resetModules();
    document.body.innerHTML = baseHtml();
    global.chrome = baseChromeMock();
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flushMicrotasks();

    expect(document.getElementById('lang-select').value).toBe('en');
    expect(document.getElementById('btn-mode-flat').textContent).toBe('Fields (flat)');
  });

  test('a stored preference overrides the detected browser language', async () => {
    jest.resetModules();
    document.body.innerHTML = baseHtml();
    global.chrome = baseChromeMock({ language: 'es' });
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flushMicrotasks();

    expect(document.getElementById('lang-select').value).toBe('es');
    expect(document.getElementById('btn-mode-flat').textContent).toBe('Campos (plano)');
  });

  test('switching language re-translates static text and persists the choice', async () => {
    jest.resetModules();
    document.body.innerHTML = baseHtml();
    global.chrome = baseChromeMock();
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flushMicrotasks();

    document.getElementById('lang-select').value = 'en';
    document.getElementById('lang-select').dispatchEvent(new Event('change'));
    await flushMicrotasks();

    expect(document.getElementById('btn-mode-flat').textContent).toBe('Fields (flat)');
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ language: 'en' });
  });

  test('switching language also re-renders dynamic content (e.g. a field row\'s remove button)', async () => {
    jest.resetModules();
    document.body.innerHTML = baseHtml();
    global.chrome = baseChromeMock();
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flushMicrotasks(); // seeded field ('Titel') is restored from session storage

    expect(document.querySelector('.btn-remove-field').textContent).toBe('Entfernen');

    document.getElementById('lang-select').value = 'en';
    document.getElementById('lang-select').dispatchEvent(new Event('change'));
    await flushMicrotasks();

    expect(document.querySelector('.btn-remove-field').textContent).toBe('Remove');
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
    expect(fieldRow.querySelector('.api-config-field-name').value).toBe('Titel');
    expect(fieldRow.textContent).toContain('name');

    const segRows = document.querySelectorAll('#api-config-segments .api-config-part-row');
    expect(Array.from(segRows).map(r => r.querySelector('.api-config-part-value').textContent)).toEqual(['/api', '/items', '/42']);
    const queryRows = document.querySelectorAll('#api-config-query-params .api-config-part-row');
    expect(queryRows[0].querySelector('.api-config-part-value').textContent).toBe('category=Elektronik');
  });

  test('renaming a field on the API_CONFIG screen carries the new name through to the confirmed apiConfig', () => {
    confirmPrimaryCandidate();

    const nameInput = document.querySelector('#api-config-fields .api-config-field-name');
    nameInput.value = 'Produktname';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.querySelector('#api-config-fields .api-config-field-name').value).toBe('Produktname');

    const toggle = document.querySelector('#api-config-segments .api-config-part-row:nth-child(3) .api-config-part-toggle');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#api-config-segments .api-config-part-name').value = 'id';
    document.querySelector('#api-config-segments .api-config-part-name').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.api-config-source-kind-radio[value="staticList"]').checked = true;
    document.querySelector('.api-config-source-kind-radio[value="staticList"]').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.api-config-static-list').value = '42';
    document.querySelector('.api-config-static-list').dispatchEvent(new Event('change', { bubbles: true }));

    document.getElementById('btn-api-config-confirm').click();

    expect(chrome.storage.session.set.mock.calls.at(-1)[0].apiConfig.fields).toEqual([{ name: 'Produktname', path: 'name' }]);
  });

  test('a blanked-out field name disables "Übernehmen" until it is filled in again', () => {
    confirmPrimaryCandidate();
    const toggle = document.querySelector('#api-config-segments .api-config-part-row:nth-child(3) .api-config-part-toggle');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#api-config-segments .api-config-part-name').value = 'id';
    document.querySelector('#api-config-segments .api-config-part-name').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.api-config-source-kind-radio[value="staticList"]').checked = true;
    document.querySelector('.api-config-source-kind-radio[value="staticList"]').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.api-config-static-list').value = '42';
    document.querySelector('.api-config-static-list').dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(false);

    const nameInput = document.querySelector('#api-config-fields .api-config-field-name');
    nameInput.value = '   ';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(true);
  });

  test('"Alle auswählen" picks every sibling in one click, toggling back to none on a second click', () => {
    document.getElementById('btn-api-capture').click();
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api' } });
    document.getElementById('btn-api-capture').click();
    document.getElementById('btn-api-search').click();

    const candidateWithSiblings = {
      ...PRIMARY_CANDIDATE,
      siblings: [
        { name: 'price', path: 'items[0].price', value: 3.5 },
        { name: 'unit', path: 'items[0].unit', value: 'kg' },
      ],
    };
    capturedListener({ type: 'API_CANDIDATES', target: 'Titel-Test', candidates: [candidateWithSiblings] });

    const chips = document.querySelectorAll('.api-sibling-chip');
    expect(Array.from(chips).some(c => c.classList.contains('picked'))).toBe(false);

    document.querySelector('.api-sibling-select-all').click();
    expect(Array.from(chips).every(c => c.classList.contains('picked'))).toBe(true);
    expect(document.querySelector('.api-sibling-select-all').textContent).toBe('Alle abwählen');

    document.querySelector('.api-sibling-select-all').click();
    expect(Array.from(chips).some(c => c.classList.contains('picked'))).toBe(false);
    expect(document.querySelector('.api-sibling-select-all').textContent).toBe('Alle auswählen');

    // Confirming with all siblings picked carries both into the field list.
    document.querySelector('.api-sibling-select-all').click();
    const nameInput = document.querySelector('.api-candidate-field-name');
    nameInput.value = 'Titel';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.api-candidate-confirm').click();

    const fieldNames = Array.from(document.querySelectorAll('#api-config-fields .api-config-field-name')).map(i => i.value);
    expect(fieldNames).toEqual(['Titel', 'price', 'unit']);
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

// ── API-mode follow-up: recorded-endpoints panel + pool-derived value-list ──
// autofill. Both features read the recorded pool via a new pull-based
// GET_API_CAPTURE_ENTRIES round trip (mirrors GET_LOGS/CHECK_ROBOTS_TXT) —
// content-script.js itself is out of scope here (covered in its own test
// file), so chrome.runtime.sendMessage is mocked directly to stand in for
// that round trip.

describe('recorded-endpoints panel and pool-derived value-list autofill', () => {
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
        <button id="btn-api-entries-toggle" disabled></button>
        <div id="api-entries-panel" class="hidden">
          <ul id="api-entries-list"></ul>
        </div>
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
        sendMessage: jest.fn().mockResolvedValue(undefined),
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
    url: 'https://example.com/api/category/obst/products',
    method: 'GET',
    path: 'data.items[0].name',
    value: 'Titel-Test',
    siblings: [],
    itemsPath: 'data.items',
    valuePath: 'name',
    requestHeaders: [],
  };

  function recordOneEntry() {
    document.getElementById('btn-api-capture').click();
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api' } });
    document.getElementById('btn-api-capture').click();
  }

  function confirmPrimaryCandidate() {
    recordOneEntry();
    document.getElementById('btn-api-search').click();
    capturedListener({ type: 'API_CANDIDATES', target: 'Titel-Test', candidates: [PRIMARY_CANDIDATE] });

    const nameInput = document.querySelector('.api-candidate-field-name');
    nameInput.value = 'Titel';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.api-candidate-confirm').click();
  }

  test('the toggle button stays disabled until something has been recorded', () => {
    expect(document.getElementById('btn-api-entries-toggle').disabled).toBe(true);
    recordOneEntry();
    expect(document.getElementById('btn-api-entries-toggle').disabled).toBe(false);
  });

  test('opening the panel fetches the pool and renders it; closing does not re-fetch', async () => {
    recordOneEntry();
    chrome.runtime.sendMessage.mockResolvedValueOnce([
      { url: 'https://example.com/api/a', method: 'GET', status: 200, contentType: 'application/json' },
      { url: 'https://example.com/api/b', method: 'GET', status: 404, contentType: null },
    ]);

    document.getElementById('btn-api-entries-toggle').click();
    await flushMicrotasks();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'GET_API_CAPTURE_ENTRIES' });
    expect(document.getElementById('api-entries-panel').classList.contains('hidden')).toBe(false);
    expect(document.querySelectorAll('#api-entries-list .api-candidate')).toHaveLength(2);

    chrome.runtime.sendMessage.mockClear();
    document.getElementById('btn-api-entries-toggle').click();

    expect(document.getElementById('api-entries-panel').classList.contains('hidden')).toBe(true);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('picking "Werteliste" auto-fills the value list from sibling requests in the pool', async () => {
    confirmPrimaryCandidate();

    // /api/category/obst/products → [api, category, obst, products]; "obst"
    // (index 2) is the part being turned into a parameter.
    const toggle = document.querySelectorAll('#api-config-segments .api-config-part-toggle')[2];
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    const nameInput = document.querySelector('#api-config-segments .api-config-part-name');
    nameInput.value = 'category';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));

    chrome.runtime.sendMessage.mockResolvedValueOnce([
      { url: 'https://example.com/api/category/obst/products' },
      { url: 'https://example.com/api/category/gemuese/products' },
      { url: 'https://example.com/api/category/tiefkuehl/products' },
    ]);

    const kindRadio = document.querySelector('.api-config-source-kind-radio[value="staticList"]');
    kindRadio.checked = true;
    kindRadio.dispatchEvent(new Event('change', { bubbles: true }));
    await flushMicrotasks();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'GET_API_CAPTURE_ENTRIES' });
    expect(document.querySelector('.api-config-static-list').value).toBe('obst\ngemuese\ntiefkuehl');
  });

  test('the "Aus Aufzeichnung übernehmen" button merges new pool matches without clobbering manual edits', async () => {
    confirmPrimaryCandidate();
    const toggle = document.querySelectorAll('#api-config-segments .api-config-part-toggle')[2];
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#api-config-segments .api-config-part-name').dispatchEvent(new Event('change', { bubbles: true }));

    // Pick Werteliste with an empty pool (no auto-fill happens), then type a
    // manual value the pool doesn't know about.
    chrome.runtime.sendMessage.mockResolvedValueOnce([]);
    const kindRadio = document.querySelector('.api-config-source-kind-radio[value="staticList"]');
    kindRadio.checked = true;
    kindRadio.dispatchEvent(new Event('change', { bubbles: true }));
    await flushMicrotasks();

    const textarea = document.querySelector('.api-config-static-list');
    textarea.value = 'handgetippt';
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    // The pool has since gained a sibling request — clicking the refresh
    // button now should append it, not replace the manual entry.
    chrome.runtime.sendMessage.mockResolvedValueOnce([
      { url: 'https://example.com/api/category/gemuese/products' },
    ]);
    document.querySelector('.api-config-autofill-pool').click();
    await flushMicrotasks();

    expect(document.querySelector('.api-config-static-list').value).toBe('handgetippt\ngemuese');
  });

  test('no new matches leaves the value list untouched', async () => {
    confirmPrimaryCandidate();
    const toggle = document.querySelectorAll('#api-config-segments .api-config-part-toggle')[2];
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#api-config-segments .api-config-part-name').dispatchEvent(new Event('change', { bubbles: true }));

    chrome.runtime.sendMessage.mockResolvedValueOnce([]);
    const kindRadio = document.querySelector('.api-config-source-kind-radio[value="staticList"]');
    kindRadio.checked = true;
    kindRadio.dispatchEvent(new Event('change', { bubbles: true }));
    await flushMicrotasks();

    expect(document.querySelector('.api-config-static-list').value).toBe('');
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

    expect(body).toEqual({
      version: '1', url: 'https://example.com', api: seededApiConfig,
      scriptFileName: null, outputFileName: null,
    });
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
