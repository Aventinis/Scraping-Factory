// Renders translated copy via i18n's t(), so a real dictionary has to be loaded.
global.chrome = global.chrome || { storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } } };
const { initI18n } = require('../i18n/i18n');
beforeAll(() => initI18n('de-DE'));

const {
  buildScrapingConfig,
} = require('./scraping-config-builder');
const { buildGroupNode } = require('./container-tree');

describe('buildScrapingConfig (flat mode)', () => {
  test('produces correct structure with multiple fields', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [
        { name: 'Titel', selector: 'h1' },
        { name: 'Preis', selector: '.price' },
      ],
    });
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
    const result = buildScrapingConfig({ url: 'https://example.com', mode: 'flat' });
    expect(result.fields).toEqual([]);
    expect(result.url).toBe('https://example.com');
    expect(result.outputFormat).toBe('Csv');
  });

  test('preserves explicit attribute value', () => {
    const result = buildScrapingConfig({
      url: 'https://x.com',
      mode: 'flat',
      fields: [
        { name: 'Link', selector: 'a', attribute: 'href' },
      ],
    });
    expect(result.fields[0].attribute).toBe('href');
  });

  test('passes through scriptFileName/outputFileName as-is (companion sanitizes/defaults)', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      scriptFileName: 'my scraper!',
      outputFileName: 'result data',
    });
    expect(result.scriptFileName).toBe('my scraper!');
    expect(result.outputFileName).toBe('result data');
  });

  test('defaults scriptFileName/outputFileName to null when not given', () => {
    const result = buildScrapingConfig({ url: 'https://example.com', mode: 'flat' });
    expect(result.scriptFileName).toBeNull();
    expect(result.outputFileName).toBeNull();
  });

  // Issue #42, Phase 7
  test('includes framePath on a field when set, omits it when not', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [
        { name: 'Preis', selector: '.price', framePath: ['#price-widget'] },
        { name: 'Titel', selector: 'h1' },
      ],
    });
    expect(result.fields[0].framePath).toEqual(['#price-widget']);
    expect(result.fields[1]).not.toHaveProperty('framePath');
  });

  // Issue #214
  test('includes download + safety net on a field when set, omits when off', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [
        {
          name: 'Datei', selector: 'a.file', attribute: 'href', download: true,
          maxDownloadSizeBytes: 1024, allowedContentTypes: ['application/pdf'],
        },
        { name: 'Titel', selector: 'h1' },
      ],
    });
    expect(result.fields[0].download).toBe(true);
    expect(result.fields[0].maxDownloadSizeBytes).toBe(1024);
    expect(result.fields[0].allowedContentTypes).toEqual(['application/pdf']);
    expect(result.fields[1]).not.toHaveProperty('download');
    expect(result.fields[1]).not.toHaveProperty('maxDownloadSizeBytes');
    expect(result.fields[1]).not.toHaveProperty('allowedContentTypes');
  });

  test('omits maxDownloadSizeBytes/allowedContentTypes when download is off', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [
        { name: 'Datei', selector: 'a.file', attribute: 'href', maxDownloadSizeBytes: 1024, allowedContentTypes: ['application/pdf'] },
      ],
    });
    expect(result.fields[0]).not.toHaveProperty('download');
    expect(result.fields[0]).not.toHaveProperty('maxDownloadSizeBytes');
    expect(result.fields[0]).not.toHaveProperty('allowedContentTypes');
  });
});

describe('buildScrapingConfig (combined mode, Issue #239)', () => {
  const combinedComponents = [
    { name: 'products', config: { version: '1', url: 'https://a.example.com', fields: [] }, savedConfigId: 1 },
    { name: 'reviews', config: { version: '1', url: 'https://b.example.com', fields: [] } },
  ];

  test('sends each already-resolved component verbatim, with savedConfigId only when present', () => {
    const result = buildScrapingConfig({ url: 'https://example.com', mode: 'combined', combinedComponents });
    expect(result).toEqual({
      version: '1',
      url: 'https://example.com',
      combined: [
        { name: 'products', config: combinedComponents[0].config, savedConfigId: 1 },
        { name: 'reviews', config: combinedComponents[1].config },
      ],
      scriptFileName: null,
      outputFileName: null,
    });
  });

  test('ignores engine/browserActions/additionalUrls/changeDetection/proxy/hardening/pagination — none of them apply at the outer Combined level', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'combined',
      engine: 'Browser',
      browserActions: [{ kind: 'click', selector: '#x' }],
      useJsonOutput: true,
      additionalUrls: ['https://extra.example.com'],
      changeDetection: { enabled: true },
      proxy: { enabled: true },
      hardening: [{ kind: 'noResult', severity: 'Error' }],
      pagination: { enabled: true },
      persistentSession: true,
      externalConfig: true,
      combinedComponents,
    });
    expect(result).not.toHaveProperty('engine');
    expect(result).not.toHaveProperty('browserActions');
    expect(result).not.toHaveProperty('additionalUrls');
    expect(result).not.toHaveProperty('changeDetection');
    expect(result).not.toHaveProperty('proxy');
    expect(result).not.toHaveProperty('hardening');
    expect(result).not.toHaveProperty('pagination');
    expect(result).not.toHaveProperty('outputFormat');
  });

  test('includePreview/includeOutputFile still apply — the final merged output is what they preview/download', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'combined',
      includePreview: true,
      includeOutputFile: true,
      combinedComponents,
    });
    expect(result.includePreview).toBe(true);
    expect(result.includeOutputFile).toBe(true);
  });

  test('an empty/missing component list sends an empty combined array rather than throwing', () => {
    const result = buildScrapingConfig({ url: 'https://example.com', mode: 'combined' });
    expect(result.combined).toEqual([]);
  });
});

describe('buildScrapingConfig (blocks mode, Issue #182)', () => {
  const blocks = [
    { name: 'Deals', outputFileName: 'deals', shape: 'flat', fields: [{ name: 'Preis', selector: '.deal', attribute: null }] },
    {
      name: 'Menu', outputFileName: 'menu', shape: 'group',
      groups: [{ kind: 'group', name: 'Item', selector: '.item', repeating: true, children: [
        { kind: 'field', name: 'Titel', selector: '.title', mode: 'text', attribute: null },
      ] }],
    },
  ];

  test('serializes each block by its own shape — fields for flat, a serialized group tree for group', () => {
    const result = buildScrapingConfig({ url: 'https://example.com', mode: 'blocks', blocks });
    expect(result).toEqual({
      version: '1',
      url: 'https://example.com',
      blocks: [
        { name: 'Deals', outputFileName: 'deals', fields: [{ name: 'Preis', selector: '.deal', attribute: null }] },
        { name: 'Menu', outputFileName: 'menu', groups: [
          { name: 'Item', selector: '.item', repeating: true, children: [
            { name: 'Titel', selector: '.title', mode: 'Text' },
          ] },
        ] },
      ],
      scriptFileName: null,
    });
  });

  test('shares engine/browserActions/additionalUrls/proxy/pagination/persistentSession with the outer request', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'blocks',
      engine: 'Browser',
      browserActions: [{ kind: 'click', selector: '#x' }],
      additionalUrls: ['https://extra.example.com'],
      proxy: { enabled: true, envVar: 'PROXY_LIST' },
      pagination: { enabled: true, kind: 'nextLink', nextLinkSelector: '.next', maxPages: 10 },
      persistentSession: true,
      blocks,
    });
    expect(result.engine).toBe('Browser');
    expect(result.browserActions).toBeDefined();
    expect(result.additionalUrls).toEqual(['https://extra.example.com']);
    expect(result.proxy).toEqual({ environmentVariableName: 'PROXY_LIST' });
    expect(result.pagination).toBeDefined();
    expect(result.persistentSession).toBe(true);
  });

  test('never includes changeDetection/hardening/outputFormat/externalConfig at the outer level', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'blocks',
      useJsonOutput: true,
      changeDetection: { enabled: true },
      hardening: [{ kind: 'noResult', severity: 'Error' }],
      externalConfig: true,
      blocks,
    });
    expect(result).not.toHaveProperty('changeDetection');
    expect(result).not.toHaveProperty('hardening');
    expect(result).not.toHaveProperty('outputFormat');
    expect(result).not.toHaveProperty('externalConfig');
    expect(result).not.toHaveProperty('groups');
    expect(result).not.toHaveProperty('apiConfig');
    expect(result).not.toHaveProperty('combined');
  });

  test('an empty/missing block list sends an empty blocks array rather than throwing', () => {
    const result = buildScrapingConfig({ url: 'https://example.com', mode: 'blocks' });
    expect(result.blocks).toEqual([]);
  });
});

// Issue #41/#42, Phase 5: engine/browserActions are mode-independent, so
// these are tested once rather than per mode (flat mode used as the
// representative case) — buildScrapingConfig's own doc comment explains why
// the omit/include behavior is important for existing-call backward-compat.
describe('buildScrapingConfig (engine / browserActions, Issue #41/#42 Phase 5)', () => {
  test('omits engine entirely when Static (the default) — byte-for-byte the same as before this existed', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
    });
    expect(result.engine).toBeUndefined();
    expect(result.browserActions).toBeUndefined();
  });

  test('includes engine when Browser, even with no browserActions', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      engine: 'Browser',
    });
    expect(result.engine).toBe('Browser');
    expect(result.browserActions).toBeUndefined();
  });

  test('includes serialized browserActions alongside engine when Browser and non-empty', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      engine: 'Browser',
      browserActions: [{ kind: 'click', selector: '#submit' }],
    });
    expect(result.engine).toBe('Browser');
    expect(result.browserActions).toEqual([{ kind: 'click', selector: '#submit' }]);
  });

  test('omits browserActions (and engine) when Static, even if actions were configured', () => {
    // Matches the popup's own UI behavior: switching back to Static hides
    // the browser-actions section without clearing it, so a user flipping
    // the toggle back and forth doesn't lose their work — but nothing
    // meaningless for the Static engine should ever reach the wire.
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      browserActions: [{ kind: 'click', selector: '#submit' }],
    });
    expect(result.engine).toBeUndefined();
    expect(result.browserActions).toBeUndefined();
  });

  test('works the same way for container and api modes', () => {
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig({ url: 'https://example.com', mode: 'container', groups, engine: 'Browser' });
    expect(containerResult.engine).toBe('Browser');

    const apiResult = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'api',
      apiConfig: { fields: [] },
      engine: 'Browser',
    });
    expect(apiResult.engine).toBe('Browser');
  });
});

// Issue #122: includePreview is mode-independent (same "only include the
// key when non-default" pattern as engine/browserActions above) — a
// checkbox left unchecked must round-trip to byte-for-byte the same
// request body as before this existed.
describe('buildScrapingConfig (includePreview, Issue #122)', () => {
  test('omits includePreview entirely when false (the default)', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
    });
    expect(result.includePreview).toBeUndefined();
  });

  test('includes includePreview: true when requested', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      includePreview: true,
    });
    expect(result.includePreview).toBe(true);
  });

  test('works the same way for container and api modes', () => {
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig({ url: 'https://example.com', mode: 'container', groups, includePreview: true });
    expect(containerResult.includePreview).toBe(true);

    const apiResult = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'api',
      apiConfig: { fields: [] },
      includePreview: true,
    });
    expect(apiResult.includePreview).toBe(true);
  });
});

// Issue #161: includeOutputFile is mode-independent too, same "only include
// the key when non-default" pattern as includePreview above — independent
// of it (either/both/neither may be requested).
describe('buildScrapingConfig (includeOutputFile, Issue #161)', () => {
  test('omits includeOutputFile entirely when false (the default)', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
    });
    expect(result.includeOutputFile).toBeUndefined();
  });

  test('includes includeOutputFile: true when requested', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      includeOutputFile: true,
    });
    expect(result.includeOutputFile).toBe(true);
  });

  test('works alongside includePreview — both may be requested at once', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      includePreview: true,
      includeOutputFile: true,
    });
    expect(result.includePreview).toBe(true);
    expect(result.includeOutputFile).toBe(true);
  });

  test('works the same way for container and api modes', () => {
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig({ url: 'https://example.com', mode: 'container', groups, includeOutputFile: true });
    expect(containerResult.includeOutputFile).toBe(true);

    const apiResult = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'api',
      apiConfig: { fields: [] },
      includeOutputFile: true,
    });
    expect(apiResult.includeOutputFile).toBe(true);
  });
});

// Issue #86: useJsonOutput is mode-independent, like includePreview above,
// but with a different "default" shape per mode — flat mode always sends an
// explicit outputFormat (Csv by default), while container/api mode omit the
// key entirely by default and only add it when Json is requested.
describe('buildScrapingConfig (useJsonOutput, Issue #86)', () => {
  test('flat mode sends outputFormat: "Csv" by default, "Json" when requested', () => {
    const defaultResult = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
    });
    expect(defaultResult.outputFormat).toBe('Csv');

    const jsonResult = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      useJsonOutput: true,
    });
    expect(jsonResult.outputFormat).toBe('Json');
  });

  test('container mode omits outputFormat by default, sends "Json" when requested', () => {
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const defaultResult = buildScrapingConfig({ url: 'https://example.com', mode: 'container', groups });
    expect(defaultResult.outputFormat).toBeUndefined();

    const jsonResult = buildScrapingConfig({ url: 'https://example.com', mode: 'container', groups, useJsonOutput: true });
    expect(jsonResult.outputFormat).toBe('Json');
  });

  test('api mode omits outputFormat by default, sends "Json" when requested', () => {
    const defaultResult = buildScrapingConfig({ url: 'https://example.com', mode: 'api', apiConfig: { fields: [] } });
    expect(defaultResult.outputFormat).toBeUndefined();

    const jsonResult = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'api',
      apiConfig: { fields: [] },
      useJsonOutput: true,
    });
    expect(jsonResult.outputFormat).toBe('Json');
  });
});

// Issue #83: additionalUrls is mode-independent too, like includePreview/
// useJsonOutput above — only included when non-empty, so the default
// (empty textarea) request stays byte-for-byte identical to before this
// existed.
describe('buildScrapingConfig (additionalUrls, Issue #83)', () => {
  test('omits additionalUrls entirely when empty (the default)', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
    });
    expect(result.additionalUrls).toBeUndefined();
  });

  test('includes additionalUrls when non-empty', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      additionalUrls: ['https://example.com/2', 'https://example.com/3'],
    });
    expect(result.additionalUrls).toEqual(['https://example.com/2', 'https://example.com/3']);
  });

  test('works the same way for container and api modes', () => {
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'container',
      groups,
      additionalUrls: ['https://example.com/2'],
    });
    expect(containerResult.additionalUrls).toEqual(['https://example.com/2']);

    const apiResult = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'api',
      apiConfig: { fields: [] },
      additionalUrls: ['https://example.com/2'],
    });
    expect(apiResult.additionalUrls).toEqual(['https://example.com/2']);
  });
});
