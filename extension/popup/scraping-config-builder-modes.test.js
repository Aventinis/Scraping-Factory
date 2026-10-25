// Renders translated copy via i18n's t(), so a real dictionary has to be loaded.
global.chrome = global.chrome || { storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } } };
const { initI18n } = require('../i18n/i18n');
const { loadVectors } = require('../../test-vectors/load');
beforeAll(() => initI18n('de-DE'));

const {
  buildScrapingConfig,
  buildConfigExport,
  configOptionsFromState,
  sanitizeFileNameBase,
  deriveScriptFileNameFromHostname,
  parseAdditionalUrls,
  addField,
  removeField,
  addBrowserAction,
  removeBrowserAction,
  updateBrowserAction,
  serializeBrowserActions,
  buildVerificationValues,
  frameBadgeHtml,
} = require('./scraping-config-builder');
const { buildGroupNode } = require('./container-tree');

describe('buildScrapingConfig (container mode)', () => {
  test('sends groups instead of fields, no outputFormat', () => {
    const groups = [buildGroupNode('Kategorie', 'section.menu-category', true)];
    const result = buildScrapingConfig({ url: 'https://example.com', mode: 'container', groups });

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
    const result = buildScrapingConfig({ url: 'https://example.com', mode: 'api', apiConfig });

    expect(result).toEqual({
      version: '1', url: 'https://example.com', api: apiConfig,
      scriptFileName: null, outputFileName: null,
    });
    expect(result.fields).toBeUndefined();
    expect(result.groups).toBeUndefined();
    expect(result.outputFormat).toBeUndefined();
  });
});

describe('buildScrapingConfig (output blueprint, container/api-tree mode, Issue #192)', () => {
  test('container mode includes outputBlueprint once the mapping is complete', () => {
    const groups = [buildGroupNode('Kategorie', 'section.menu-category', true)];
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'container',
      groups,
      outputBlueprint: { id: '3', fieldNames: ['name'], mapping: { name: 'Kategorie' } },
    });

    expect(result.outputBlueprint).toEqual({
      blueprintId: 3,
      schemaKind: 'Flat',
      fields: [{ targetField: 'name', sourceField: 'Kategorie' }],
    });
  });

  test('container mode omits outputBlueprint while the mapping is incomplete', () => {
    const groups = [buildGroupNode('Kategorie', 'section.menu-category', true)];
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'container',
      groups,
      outputBlueprint: { id: '3', fieldNames: ['name', 'price'], mapping: { name: 'Kategorie', price: null } },
    });

    expect(result.outputBlueprint).toBeUndefined();
  });

  test('api mode includes outputBlueprint for the tree shape too (unlike Issue #191, no longer flat-only)', () => {
    const apiConfig = {
      urlTemplate: 'https://example.com/api',
      groups: [{ name: 'Kategorie', path: 'categories', children: [{ name: 'Titel', path: 'name' }] }],
    };
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'api',
      apiConfig,
      outputBlueprint: { id: '5', fieldNames: ['title'], mapping: { title: 'Titel' } },
    });

    expect(result.outputBlueprint).toEqual({
      blueprintId: 5,
      schemaKind: 'Flat',
      fields: [{ targetField: 'title', sourceField: 'Titel' }],
    });
  });

  // Issue #244: the tree-shaped mapping's own trailing parameters.
  test('container mode includes a Tree-schema outputBlueprint once the tree mapping is complete', () => {
    const groups = [buildGroupNode('Kategorie', 'section.menu-category', true)];
    const treeSchema = [{ name: 'Name' }];
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'container',
      groups,
      outputBlueprint: { id: '4', schemaKind: 'Tree', tree: treeSchema, treeMapping: { 0: 'Kategorie' } },
    });

    expect(result.outputBlueprint).toEqual({
      blueprintId: 4,
      schemaKind: 'Tree',
      tree: [{ name: 'Name', sourceField: 'Kategorie' }],
    });
  });

  test('container mode omits a Tree-schema outputBlueprint while the tree mapping is incomplete', () => {
    const groups = [buildGroupNode('Kategorie', 'section.menu-category', true)];
    const treeSchema = [{ name: 'Name' }];
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'container',
      groups,
      outputBlueprint: { id: '4', schemaKind: 'Tree', tree: treeSchema, treeMapping: { 0: null } },
    });

    expect(result.outputBlueprint).toBeUndefined();
  });
});

// ── sanitizeFileNameBase ─────────────────────────────────────────────────────
// Must reach the same name as the companion's FileNameSanitizer for the same
// raw input (the downloaded file name vs. the script's "# Run: python X.py"
// comment). Both sides run test-vectors/file-name-sanitizer.json
// (FileNameSanitizerTests.cs is the C# half).

describe('sanitizeFileNameBase (shared vectors)', () => {
  const { cases } = loadVectors('file-name-sanitizer.json');
  test.each(cases.map((c) => [c.name, c]))('%s', (_name, c) => {
    expect(sanitizeFileNameBase(c.input, c.fallback)).toBe(c.expected);
  });

  test('undefined input falls back like null', () => {
    expect(sanitizeFileNameBase(undefined, 'scraper')).toBe('scraper');
  });
});

// ── deriveScriptFileNameFromHostname ────────────────────────────────────────
// The default script name itself (host name or fixed name, shown as the placeholder) is name-defaults.test.js.

describe('deriveScriptFileNameFromHostname', () => {
  test('sanitizes the URL\'s own hostname', () => {
    expect(deriveScriptFileNameFromHostname('https://www.example.com/products?x=1', 'scraper')).toBe('www_example_com');
  });

  test('falls back for a malformed/relative URL', () => {
    expect(deriveScriptFileNameFromHostname('not a url', 'scraper')).toBe('scraper');
    expect(deriveScriptFileNameFromHostname('', 'scraper')).toBe('scraper');
  });
});

// ── parseAdditionalUrls ──────────────────────────────────────────────────────
// Issue #83: one URL per line, pasted/typed into the additional-start-urls
// textarea.

describe('parseAdditionalUrls', () => {
  test('splits on newlines and trims each entry', () => {
    expect(parseAdditionalUrls('https://example.com/a\n  https://example.com/b  '))
      .toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  test('drops blank lines', () => {
    expect(parseAdditionalUrls('https://example.com/a\n\n   \nhttps://example.com/b\n'))
      .toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  test('returns an empty array for empty/null/undefined input', () => {
    expect(parseAdditionalUrls('')).toEqual([]);
    expect(parseAdditionalUrls(null)).toEqual([]);
    expect(parseAdditionalUrls(undefined)).toEqual([]);
  });

  test('leaves a malformed non-blank entry as-is (the companion validates it)', () => {
    expect(parseAdditionalUrls('not-a-url')).toEqual(['not-a-url']);
  });
});

// ── buildConfigExport ────────────────────────────────────────────────────────
// Lets a user attach their current Fields/Groups to a bug report — wraps the
// exact wire-format config (buildScrapingConfig) with export metadata.

describe('buildConfigExport', () => {
  test('wraps the flat-mode config with exportedAt and the extension version', () => {
    const fields = [{ name: 'Titel', selector: 'h1', attribute: null }];
    const result = buildConfigExport({ url: 'https://example.com', mode: 'flat', fields, manifest: { version: '1.2.3' } });

    expect(result.extensionVersion).toBe('1.2.3');
    expect(() => new Date(result.exportedAt).toISOString()).not.toThrow();
    expect(result.config).toEqual(buildScrapingConfig({ url: 'https://example.com', mode: 'flat', fields }));
  });

  test('wraps the container-mode config (groups) the same way', () => {
    const groups = [buildGroupNode('Kategorie', 'section.menu-category', true)];
    const result = buildConfigExport({ url: 'https://example.com', mode: 'container', groups, manifest: { version: '1.2.3' } });

    expect(result.config).toEqual(buildScrapingConfig({ url: 'https://example.com', mode: 'container', groups }));
    expect(result.config.groups).toBeDefined();
    expect(result.config.fields).toBeUndefined();
  });

  test('falls back to "?" when no manifest/version is available', () => {
    const result = buildConfigExport({ url: 'https://example.com', mode: 'flat' });
    expect(result.extensionVersion).toBe('?');
  });

  test('wraps the api-mode config (api) the same way (Issue #53 Phase 6)', () => {
    const apiConfig = { urlTemplate: 'https://example.com/api/{id}', itemsPath: 'data', fields: [], parameters: [] };
    const result = buildConfigExport({ url: 'https://example.com', mode: 'api', manifest: { version: '1.2.3' }, apiConfig });

    expect(result.config).toEqual(buildScrapingConfig({ url: 'https://example.com', mode: 'api', apiConfig }));
    expect(result.config.api).toEqual(apiConfig);
  });

  test('carries scriptFileName/outputFileName through into the wrapped config', () => {
    const result = buildConfigExport({
      url: 'https://example.com',
      mode: 'flat',
      manifest: { version: '1.2.3' },
      scriptFileName: 'myscraper',
      outputFileName: 'result',
    });
    expect(result.config.scriptFileName).toBe('myscraper');
    expect(result.config.outputFileName).toBe('result');
  });
});

// ── addField ─────────────────────────────────────────────────────────────────

// The one mapping from popup state + global settings to buildScrapingConfig's options (Issue #387): generate(), "Save configuration"
// and "Export configuration" all go through it.
describe('configOptionsFromState', () => {
  const state = {
    url: 'https://example.com/list', mode: 'flat', fields: [{ name: 'Titel', selector: 'h1', attribute: null }], groups: [], apiConfig: null,
    scriptFileName: 'my_script', outputFileName: 'my_output', engine: 'Browser', browserActions: [{ kind: 'click', selector: '.go' }],
    persistentSession: true, additionalStartUrls: ['https://example.com/2'], pagination: null, discoveredUrls: null, preflight: true,
    changeDetection: null, proxy: { enabled: true, envVar: 'PROXY_LIST' }, hardening: null, requestDelay: null, retry: null,
    deduplication: null, requestHeaders: null, respectRobotsDelay: true, robotsDisallow: null, appendOutput: true, blocks: null,
    selectedOutputBlueprintId: '7', selectedOutputBlueprintSchemaKind: 'Flat', selectedOutputBlueprintFieldNames: ['name'],
    outputBlueprintMapping: { name: 'Titel' }, selectedOutputBlueprintTree: [], outputBlueprintTreeMapping: {},
  };
  const globalSettings = { includeDataPreview: true, outputFormat: 'json', includeOutputFile: true, externalConfig: true, skipVerification: true };

  test('maps every piece of state and the global settings onto the options', () => {
    const config = buildScrapingConfig(configOptionsFromState(state, globalSettings));
    expect(config).toMatchObject({
      url: 'https://example.com/list', engine: 'Browser', scriptFileName: 'my_script', outputFileName: 'my_output', persistentSession: true,
      additionalUrls: ['https://example.com/2'], preflight: true, respectRobotsDelay: true, appendOutput: true,
      proxy: { environmentVariableName: 'PROXY_LIST' }, outputFormat: 'Json', includePreview: true, includeOutputFile: true,
      externalConfig: true, skipVerification: true, outputBlueprint: { blueprintId: 7, schemaKind: 'Flat' },
    });
  });

  test('the nested blueprint options reach the request', () => {
    const options = configOptionsFromState(state, globalSettings);
    expect(options.outputBlueprint).toEqual({
      id: '7', schemaKind: 'Flat', fieldNames: ['name'], mapping: { name: 'Titel' }, tree: [], treeMapping: {},
    });
  });

  test('overrides win: a save keeps the output file out, an export adds the manifest', () => {
    const save = buildScrapingConfig(configOptionsFromState(state, globalSettings, { includeOutputFile: false }));
    expect(save).not.toHaveProperty('includeOutputFile');
    const exported = buildConfigExport(configOptionsFromState(state, globalSettings, { manifest: { version: '9.9.9' } }));
    expect(exported.extensionVersion).toBe('9.9.9');
    expect(exported.config).toMatchObject({ url: 'https://example.com/list', includeOutputFile: true });
  });

  test('the config of an export equals buildScrapingConfig for the same options', () => {
    const options = configOptionsFromState(state, globalSettings);
    expect(buildConfigExport(options).config).toEqual(buildScrapingConfig(options));
  });
});

describe('addField', () => {
  test('appends field with null attribute', () => {
    const result = addField([], 'Titel', 'h1');
    expect(result).toEqual([{
      name: 'Titel', selector: 'h1', attribute: null, framePath: null, transforms: null,
      download: false, maxDownloadSizeBytes: null, allowedContentTypes: [], hiddenFromOutput: false,
    }]);
  });

  // Issue #42, Phase 7
  test('appends field with framePath when given', () => {
    const result = addField([], 'Preis', 'h2', { framePath: ['#price-widget'] });
    expect(result).toEqual([{
      name: 'Preis', selector: 'h2', attribute: null, framePath: ['#price-widget'], transforms: null,
      download: false, maxDownloadSizeBytes: null, allowedContentTypes: [], hiddenFromOutput: false,
    }]);
  });

  // Issue #84
  test('appends field with transforms when given', () => {
    const transforms = [{ kind: 'trim' }, { kind: 'toNumber' }];
    const result = addField([], 'Preis', '.price', { framePath: null, transforms });
    expect(result).toEqual([{
      name: 'Preis', selector: '.price', attribute: null, framePath: null, transforms,
      download: false, maxDownloadSizeBytes: null, allowedContentTypes: [], hiddenFromOutput: false,
    }]);
  });

  // Issue #214
  test('appends attribute-mode field with download and safety net when given', () => {
    const result = addField([], 'Datei', 'a.file', { framePath: null, transforms: [], attribute: 'href', download: true, maxDownloadSizeBytes: 1024, allowedContentTypes: ['application/pdf'] });
    expect(result).toEqual([{
      name: 'Datei', selector: 'a.file', attribute: 'href', framePath: null, transforms: null,
      download: true, maxDownloadSizeBytes: 1024, allowedContentTypes: ['application/pdf'], hiddenFromOutput: false,
    }]);
  });

  test('ignores download/safety net when no attribute is given', () => {
    const result = addField([], 'Titel', 'h1', { framePath: null, transforms: [], attribute: null, download: true, maxDownloadSizeBytes: 1024, allowedContentTypes: ['application/pdf'] });
    expect(result).toEqual([{
      name: 'Titel', selector: 'h1', attribute: null, framePath: null, transforms: null,
      download: false, maxDownloadSizeBytes: null, allowedContentTypes: [], hiddenFromOutput: false,
    }]);
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
    expect(addBrowserAction([], 'click')).toEqual([{ kind: 'click', selector: '', target: 'first', waitAfterMs: 250 }]);
  });

  test('appends a scroll action with defaults (Issue #41, Phase 6)', () => {
    expect(addBrowserAction([], 'scroll')).toEqual([
      { kind: 'scroll', containerSelector: '', loadMoreButtonSelector: '', maxIterations: 10, waitAfterMs: 1000, scrollStepPx: null },
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

  // Issue #289
  test('serializes scrollStepPx when set', () => {
    const actions = [{ kind: 'scroll', containerSelector: '', loadMoreButtonSelector: '', maxIterations: 10, waitAfterMs: 1000, scrollStepPx: 400 }];
    expect(serializeBrowserActions(actions)[0].scrollStepPx).toBe(400);
  });

  test('omits scrollStepPx entirely (not null/0) when unset, keeping the jump-to-bottom default', () => {
    const actions = [{ kind: 'scroll', containerSelector: '', loadMoreButtonSelector: '', maxIterations: 10, waitAfterMs: 1000, scrollStepPx: null }];
    expect(serializeBrowserActions(actions)[0]).not.toHaveProperty('scrollStepPx');
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
