// frameBadgeHtml (below) renders translated copy via i18n.js's t() — needs a
// real dictionary loaded, same as popup.test.js's own top-level setup
// achieves indirectly by requiring ./popup (which calls initI18n() as part
// of init()).
global.chrome = global.chrome || { storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } } };
const { initI18n } = require('../i18n/i18n');
beforeAll(() => initI18n('de-DE'));

const {
  buildScrapingConfig, buildConfigExport,
  sanitizeFileNameBase, parseAdditionalUrls,
  buildChangeDetectionConfig, buildProxyConfig, buildPaginationConfig, buildHardeningConfig,
  computeInitialMonitoringSectionOpen, collectFieldNames,
  addField, removeField,
  addBrowserAction, removeBrowserAction, updateBrowserAction, serializeBrowserActions,
  buildVerificationValues,
  addNullRateCheck, removeNullRateCheck, updateNullRateCheck,
  addRequiredField, removeRequiredField,
  frameBadgeHtml,
} = require('./scraping-config-builder');

const { buildGroupNode } = require('./container-tree');

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

describe('buildScrapingConfig (combined mode, Issue #239)', () => {
  const combinedComponents = [
    { name: 'products', config: { version: '1', url: 'https://a.example.com', fields: [] }, savedConfigId: 1 },
    { name: 'reviews', config: { version: '1', url: 'https://b.example.com', fields: [] } },
  ];

  test('sends each already-resolved component verbatim, with savedConfigId only when present', () => {
    const result = buildScrapingConfig(
      'https://example.com', 'combined', [], [], null, null, null,
      'Static', [], false, false, [], null, null, null, null, false, false, false, combinedComponents,
    );
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
    const result = buildScrapingConfig(
      'https://example.com', 'combined', [], [], null, null, null,
      'Browser', [{ kind: 'click', selector: '#x' }], false, true, ['https://extra.example.com'],
      { enabled: true }, { enabled: true }, [{ kind: 'noResult', severity: 'Error' }],
      { enabled: true }, true, false, true, combinedComponents,
    );
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
    const result = buildScrapingConfig(
      'https://example.com', 'combined', [], [], null, null, null,
      'Static', [], true, false, [], null, null, null, null, false, true, false, combinedComponents,
    );
    expect(result.includePreview).toBe(true);
    expect(result.includeOutputFile).toBe(true);
  });

  test('an empty/missing component list sends an empty combined array rather than throwing', () => {
    const result = buildScrapingConfig('https://example.com', 'combined', [], []);
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
    const result = buildScrapingConfig(
      'https://example.com', 'blocks', [], [], null, null, null,
      'Static', [], false, false, [], null, null, null, null, false, false, false, null, blocks,
    );
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
    const result = buildScrapingConfig(
      'https://example.com', 'blocks', [], [], null, null, null,
      'Browser', [{ kind: 'click', selector: '#x' }], false, false, ['https://extra.example.com'],
      null, { enabled: true, envVar: 'PROXY_LIST' }, null,
      { enabled: true, kind: 'nextLink', nextLinkSelector: '.next', maxPages: 10 }, true, false, false, null, blocks,
    );
    expect(result.engine).toBe('Browser');
    expect(result.browserActions).toBeDefined();
    expect(result.additionalUrls).toEqual(['https://extra.example.com']);
    expect(result.proxy).toEqual({ environmentVariableName: 'PROXY_LIST' });
    expect(result.pagination).toBeDefined();
    expect(result.persistentSession).toBe(true);
  });

  test('never includes changeDetection/hardening/outputFormat/externalConfig at the outer level', () => {
    const result = buildScrapingConfig(
      'https://example.com', 'blocks', [], [], null, null, null,
      'Static', [], false, true, [], { enabled: true }, null, [{ kind: 'noResult', severity: 'Error' }],
      null, false, false, true, null, blocks,
    );
    expect(result).not.toHaveProperty('changeDetection');
    expect(result).not.toHaveProperty('hardening');
    expect(result).not.toHaveProperty('outputFormat');
    expect(result).not.toHaveProperty('externalConfig');
    expect(result).not.toHaveProperty('groups');
    expect(result).not.toHaveProperty('apiConfig');
    expect(result).not.toHaveProperty('combined');
  });

  test('an empty/missing block list sends an empty blocks array rather than throwing', () => {
    const result = buildScrapingConfig('https://example.com', 'blocks', [], []);
    expect(result.blocks).toEqual([]);
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

// Issue #122: includePreview is mode-independent (same "only include the
// key when non-default" pattern as engine/browserActions above) — a
// checkbox left unchecked must round-trip to byte-for-byte the same
// request body as before this existed.
describe('buildScrapingConfig (includePreview, Issue #122)', () => {
  test('omits includePreview entirely when false (the default)', () => {
    const result = buildScrapingConfig('https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }]);
    expect(result.includePreview).toBeUndefined();
  });

  test('includes includePreview: true when requested', () => {
    const result = buildScrapingConfig(
      'https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }], [], null, null, null, 'Static', [], true,
    );
    expect(result.includePreview).toBe(true);
  });

  test('works the same way for container and api modes', () => {
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig('https://example.com', 'container', [], groups, null, null, null, 'Static', [], true);
    expect(containerResult.includePreview).toBe(true);

    const apiResult = buildScrapingConfig('https://example.com', 'api', [], [], { fields: [] }, null, null, 'Static', [], true);
    expect(apiResult.includePreview).toBe(true);
  });
});

// Issue #161: includeOutputFile is mode-independent too, same "only include
// the key when non-default" pattern as includePreview above — independent
// of it (either/both/neither may be requested).
describe('buildScrapingConfig (includeOutputFile, Issue #161)', () => {
  test('omits includeOutputFile entirely when false (the default)', () => {
    const result = buildScrapingConfig('https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }]);
    expect(result.includeOutputFile).toBeUndefined();
  });

  test('includes includeOutputFile: true when requested', () => {
    const result = buildScrapingConfig(
      'https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }], [], null, null, null, 'Static', [], false,
      false, [], null, null, null, null, false, true,
    );
    expect(result.includeOutputFile).toBe(true);
  });

  test('works alongside includePreview — both may be requested at once', () => {
    const result = buildScrapingConfig(
      'https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }], [], null, null, null, 'Static', [], true,
      false, [], null, null, null, null, false, true,
    );
    expect(result.includePreview).toBe(true);
    expect(result.includeOutputFile).toBe(true);
  });

  test('works the same way for container and api modes', () => {
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig(
      'https://example.com', 'container', [], groups, null, null, null, 'Static', [], false, false, [], null, null,
      null, null, false, true,
    );
    expect(containerResult.includeOutputFile).toBe(true);

    const apiResult = buildScrapingConfig(
      'https://example.com', 'api', [], [], { fields: [] }, null, null, 'Static', [], false, false, [], null, null,
      null, null, false, true,
    );
    expect(apiResult.includeOutputFile).toBe(true);
  });
});

// Issue #86: useJsonOutput is mode-independent, like includePreview above,
// but with a different "default" shape per mode — flat mode always sends an
// explicit outputFormat (Csv by default), while container/api mode omit the
// key entirely by default and only add it when Json is requested.
describe('buildScrapingConfig (useJsonOutput, Issue #86)', () => {
  test('flat mode sends outputFormat: "Csv" by default, "Json" when requested', () => {
    const defaultResult = buildScrapingConfig('https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }]);
    expect(defaultResult.outputFormat).toBe('Csv');

    const jsonResult = buildScrapingConfig(
      'https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }], [], null, null, null, 'Static', [], false, true,
    );
    expect(jsonResult.outputFormat).toBe('Json');
  });

  test('container mode omits outputFormat by default, sends "Json" when requested', () => {
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const defaultResult = buildScrapingConfig('https://example.com', 'container', [], groups);
    expect(defaultResult.outputFormat).toBeUndefined();

    const jsonResult = buildScrapingConfig(
      'https://example.com', 'container', [], groups, null, null, null, 'Static', [], false, true,
    );
    expect(jsonResult.outputFormat).toBe('Json');
  });

  test('api mode omits outputFormat by default, sends "Json" when requested', () => {
    const defaultResult = buildScrapingConfig('https://example.com', 'api', [], [], { fields: [] });
    expect(defaultResult.outputFormat).toBeUndefined();

    const jsonResult = buildScrapingConfig(
      'https://example.com', 'api', [], [], { fields: [] }, null, null, 'Static', [], false, true,
    );
    expect(jsonResult.outputFormat).toBe('Json');
  });
});

// Issue #83: additionalUrls is mode-independent too, like includePreview/
// useJsonOutput above — only included when non-empty, so the default
// (empty textarea) request stays byte-for-byte identical to before this
// existed.
describe('buildScrapingConfig (additionalUrls, Issue #83)', () => {
  test('omits additionalUrls entirely when empty (the default)', () => {
    const result = buildScrapingConfig('https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }]);
    expect(result.additionalUrls).toBeUndefined();
  });

  test('includes additionalUrls when non-empty', () => {
    const result = buildScrapingConfig(
      'https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }], [], null, null, null, 'Static', [], false,
      false, ['https://example.com/2', 'https://example.com/3'],
    );
    expect(result.additionalUrls).toEqual(['https://example.com/2', 'https://example.com/3']);
  });

  test('works the same way for container and api modes', () => {
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig(
      'https://example.com', 'container', [], groups, null, null, null, 'Static', [], false, false, ['https://example.com/2'],
    );
    expect(containerResult.additionalUrls).toEqual(['https://example.com/2']);

    const apiResult = buildScrapingConfig(
      'https://example.com', 'api', [], [], { fields: [] }, null, null, 'Static', [], false, false, ['https://example.com/2'],
    );
    expect(apiResult.additionalUrls).toEqual(['https://example.com/2']);
  });
});

// Issue #87: every field is an environment-variable *name*, never a value.
describe('buildChangeDetectionConfig', () => {
  const draft = (overrides = {}) => ({
    enabled: true,
    notify: 'Email',
    email: { smtpHostEnvVar: '', smtpPortEnvVar: '', smtpUsernameEnvVar: '', smtpPasswordEnvVar: '', fromEnvVar: '', toEnvVar: '' },
    webhook: { urlEnvVar: '' },
    ...overrides,
  });

  test('returns null when disabled', () => {
    expect(buildChangeDetectionConfig(draft({ enabled: false }))).toBeNull();
  });

  test('returns null for null/undefined input', () => {
    expect(buildChangeDetectionConfig(null)).toBeNull();
    expect(buildChangeDetectionConfig(undefined)).toBeNull();
  });

  test('email: returns null when a required field is blank', () => {
    expect(buildChangeDetectionConfig(draft({
      email: { smtpHostEnvVar: '', smtpPortEnvVar: '', smtpUsernameEnvVar: '', smtpPasswordEnvVar: '', fromEnvVar: 'SF_FROM', toEnvVar: 'SF_TO' },
    }))).toBeNull();
  });

  test('email: builds the wire shape with only required fields set', () => {
    const result = buildChangeDetectionConfig(draft({
      email: { smtpHostEnvVar: 'SF_SMTP_HOST', smtpPortEnvVar: '', smtpUsernameEnvVar: '', smtpPasswordEnvVar: '', fromEnvVar: 'SF_FROM', toEnvVar: 'SF_TO' },
    }));
    expect(result).toEqual({
      notify: 'Email',
      email: { smtpHostEnvVar: 'SF_SMTP_HOST', fromEnvVar: 'SF_FROM', toEnvVar: 'SF_TO' },
    });
  });

  test('email: includes optional fields when set', () => {
    const result = buildChangeDetectionConfig(draft({
      email: {
        smtpHostEnvVar: 'SF_SMTP_HOST', smtpPortEnvVar: 'SF_SMTP_PORT', smtpUsernameEnvVar: 'SF_SMTP_USER',
        smtpPasswordEnvVar: 'SF_SMTP_PASS', fromEnvVar: 'SF_FROM', toEnvVar: 'SF_TO',
      },
    }));
    expect(result).toEqual({
      notify: 'Email',
      email: {
        smtpHostEnvVar: 'SF_SMTP_HOST', fromEnvVar: 'SF_FROM', toEnvVar: 'SF_TO',
        smtpPortEnvVar: 'SF_SMTP_PORT', smtpUsernameEnvVar: 'SF_SMTP_USER', smtpPasswordEnvVar: 'SF_SMTP_PASS',
      },
    });
  });

  test('webhook: returns null when urlEnvVar is blank', () => {
    expect(buildChangeDetectionConfig(draft({ notify: 'Webhook', webhook: { urlEnvVar: '' } }))).toBeNull();
  });

  test('webhook: builds the wire shape', () => {
    const result = buildChangeDetectionConfig(draft({ notify: 'Webhook', webhook: { urlEnvVar: 'SF_WEBHOOK_URL' } }));
    expect(result).toEqual({ notify: 'Webhook', webhook: { urlEnvVar: 'SF_WEBHOOK_URL' } });
  });
});

describe('buildScrapingConfig (changeDetection, Issue #87)', () => {
  test('omits changeDetection entirely when disabled (the default)', () => {
    const result = buildScrapingConfig('https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }]);
    expect(result.changeDetection).toBeUndefined();
  });

  test('includes changeDetection when enabled and fully configured', () => {
    const changeDetection = {
      enabled: true, notify: 'Webhook',
      email: { smtpHostEnvVar: '', smtpPortEnvVar: '', smtpUsernameEnvVar: '', smtpPasswordEnvVar: '', fromEnvVar: '', toEnvVar: '' },
      webhook: { urlEnvVar: 'SF_WEBHOOK_URL' },
    };
    const result = buildScrapingConfig(
      'https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }], [], null, null, null, 'Static', [], false,
      false, [], changeDetection,
    );
    expect(result.changeDetection).toEqual({ notify: 'Webhook', webhook: { urlEnvVar: 'SF_WEBHOOK_URL' } });
  });

  test('works the same way for container and api modes', () => {
    const changeDetection = {
      enabled: true, notify: 'Webhook',
      email: { smtpHostEnvVar: '', smtpPortEnvVar: '', smtpUsernameEnvVar: '', smtpPasswordEnvVar: '', fromEnvVar: '', toEnvVar: '' },
      webhook: { urlEnvVar: 'SF_WEBHOOK_URL' },
    };
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig(
      'https://example.com', 'container', [], groups, null, null, null, 'Static', [], false, false, [], changeDetection,
    );
    expect(containerResult.changeDetection).toEqual({ notify: 'Webhook', webhook: { urlEnvVar: 'SF_WEBHOOK_URL' } });

    const apiResult = buildScrapingConfig(
      'https://example.com', 'api', [], [], { fields: [] }, null, null, 'Static', [], false, false, [], changeDetection,
    );
    expect(apiResult.changeDetection).toEqual({ notify: 'Webhook', webhook: { urlEnvVar: 'SF_WEBHOOK_URL' } });
  });
});

// Issue #88: the env var holds a comma-separated proxy URL list, never a
// literal proxy address.
describe('buildProxyConfig', () => {
  test('returns null when disabled', () => {
    expect(buildProxyConfig({ enabled: false, envVar: 'SF_PROXIES' })).toBeNull();
  });

  test('returns null for null/undefined input', () => {
    expect(buildProxyConfig(null)).toBeNull();
    expect(buildProxyConfig(undefined)).toBeNull();
  });

  test('returns null when enabled but envVar is blank', () => {
    expect(buildProxyConfig({ enabled: true, envVar: '' })).toBeNull();
    expect(buildProxyConfig({ enabled: true, envVar: '   ' })).toBeNull();
  });

  test('builds the wire shape with a trimmed env var name', () => {
    expect(buildProxyConfig({ enabled: true, envVar: '  SF_PROXIES  ' })).toEqual({
      environmentVariableName: 'SF_PROXIES',
    });
  });
});

describe('buildScrapingConfig (proxy, Issue #88)', () => {
  test('omits proxy entirely when disabled (the default)', () => {
    const result = buildScrapingConfig('https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }]);
    expect(result.proxy).toBeUndefined();
  });

  test('includes proxy when enabled and configured', () => {
    const proxy = { enabled: true, envVar: 'SF_PROXIES' };
    const result = buildScrapingConfig(
      'https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }], [], null, null, null, 'Static', [], false,
      false, [], null, proxy,
    );
    expect(result.proxy).toEqual({ environmentVariableName: 'SF_PROXIES' });
  });

  test('works the same way for container and api modes', () => {
    const proxy = { enabled: true, envVar: 'SF_PROXIES' };
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig(
      'https://example.com', 'container', [], groups, null, null, null, 'Static', [], false, false, [], null, proxy,
    );
    expect(containerResult.proxy).toEqual({ environmentVariableName: 'SF_PROXIES' });

    const apiResult = buildScrapingConfig(
      'https://example.com', 'api', [], [], { fields: [] }, null, null, 'Static', [], false, false, [], null, proxy,
    );
    expect(apiResult.proxy).toEqual({ environmentVariableName: 'SF_PROXIES' });
  });
});

// Issue #174
describe('buildPaginationConfig', () => {
  test('returns null when disabled', () => {
    expect(buildPaginationConfig({ enabled: false, kind: 'nextLink', nextLinkSelector: 'a.next', maxPages: 50 })).toBeNull();
  });

  test('returns null for null/undefined input', () => {
    expect(buildPaginationConfig(null)).toBeNull();
    expect(buildPaginationConfig(undefined)).toBeNull();
  });

  test('returns null for nextLink kind when the selector is blank', () => {
    expect(buildPaginationConfig({ enabled: true, kind: 'nextLink', nextLinkSelector: '', maxPages: 50 })).toBeNull();
    expect(buildPaginationConfig({ enabled: true, kind: 'nextLink', nextLinkSelector: '   ', maxPages: 50 })).toBeNull();
  });

  test('returns null for pageNumber kind when the template is blank', () => {
    expect(buildPaginationConfig({ enabled: true, kind: 'pageNumber', urlTemplate: '', maxPages: 50 })).toBeNull();
  });

  test('builds the nextLink wire shape with a trimmed selector', () => {
    expect(buildPaginationConfig({ enabled: true, kind: 'nextLink', nextLinkSelector: '  a.next  ', maxPages: 20 })).toEqual({
      kind: 'nextLink', nextLinkSelector: 'a.next', maxPages: 20,
    });
  });

  test('builds the pageNumber wire shape with a trimmed template', () => {
    expect(buildPaginationConfig({ enabled: true, kind: 'pageNumber', urlTemplate: '  {url}?page={page}  ', maxPages: 20 })).toEqual({
      kind: 'pageNumber', urlTemplate: '{url}?page={page}', maxPages: 20,
    });
  });

  test('clamps/defaults an invalid maxPages to 50', () => {
    for (const invalid of [0, NaN, -5]) {
      expect(buildPaginationConfig({ enabled: true, kind: 'nextLink', nextLinkSelector: 'a.next', maxPages: invalid })).toEqual({
        kind: 'nextLink', nextLinkSelector: 'a.next', maxPages: 50,
      });
    }
  });

  test('floors a fractional maxPages', () => {
    expect(buildPaginationConfig({ enabled: true, kind: 'nextLink', nextLinkSelector: 'a.next', maxPages: 12.7 })).toEqual({
      kind: 'nextLink', nextLinkSelector: 'a.next', maxPages: 12,
    });
  });
});

describe('buildScrapingConfig (pagination, Issue #174)', () => {
  test('omits pagination entirely when disabled (the default)', () => {
    const result = buildScrapingConfig('https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }]);
    expect(result.pagination).toBeUndefined();
  });

  test('includes pagination when enabled and configured', () => {
    const pagination = { enabled: true, kind: 'nextLink', nextLinkSelector: 'a.next', maxPages: 30 };
    const result = buildScrapingConfig(
      'https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }], [], null, null, null, 'Static', [], false,
      false, [], null, null, null, pagination,
    );
    expect(result.pagination).toEqual({ kind: 'nextLink', nextLinkSelector: 'a.next', maxPages: 30 });
  });

  test('works the same way for container mode', () => {
    const pagination = { enabled: true, kind: 'pageNumber', urlTemplate: '{url}?page={page}', maxPages: 10 };
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig(
      'https://example.com', 'container', [], groups, null, null, null, 'Static', [], false, false, [], null, null, null, pagination,
    );
    expect(containerResult.pagination).toEqual({ kind: 'pageNumber', urlTemplate: '{url}?page={page}', maxPages: 10 });
  });
});

// Issue #175
describe('buildScrapingConfig (persistentSession, Issue #175)', () => {
  test('omits persistentSession entirely when false (the default)', () => {
    const result = buildScrapingConfig('https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }]);
    expect(result.persistentSession).toBeUndefined();
  });

  test('includes persistentSession: true when enabled', () => {
    const result = buildScrapingConfig(
      'https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }], [], null, null, null, 'Browser', [], false,
      false, [], null, null, null, null, true,
    );
    expect(result.persistentSession).toBe(true);
  });

  test('works the same way for container and api modes', () => {
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig(
      'https://example.com', 'container', [], groups, null, null, null, 'Browser', [], false, false, [], null, null, null, null, true,
    );
    expect(containerResult.persistentSession).toBe(true);

    const apiResult = buildScrapingConfig(
      'https://example.com', 'api', [], [], { fields: [] }, null, null, 'Browser', [], false, false, [], null, null, null, null, true,
    );
    expect(apiResult.persistentSession).toBe(true);
  });
});

// Issue #178
describe('buildScrapingConfig (externalConfig)', () => {
  test('omits externalConfig entirely when false (the default)', () => {
    const result = buildScrapingConfig('https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }]);
    expect(result.externalConfig).toBeUndefined();
  });

  test('includes externalConfig: true when enabled', () => {
    const result = buildScrapingConfig(
      'https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }], [], null, null, null, 'Static', [], false,
      false, [], null, null, null, null, false, false, true,
    );
    expect(result.externalConfig).toBe(true);
  });

  test('works the same way for container and api modes', () => {
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig(
      'https://example.com', 'container', [], groups, null, null, null, 'Static', [], false, false, [], null, null, null, null, false, false, true,
    );
    expect(containerResult.externalConfig).toBe(true);

    const apiResult = buildScrapingConfig(
      'https://example.com', 'api', [], [], { fields: [] }, null, null, 'Static', [], false, false, [], null, null, null, null, false, false, true,
    );
    expect(apiResult.externalConfig).toBe(true);
  });
});

// Issue #129
describe('buildHardeningConfig', () => {
  test('returns null when noResult is disabled', () => {
    expect(buildHardeningConfig({ noResult: { enabled: false, severity: 'Warning' } })).toBeNull();
  });

  test('returns null for null/undefined input', () => {
    expect(buildHardeningConfig(null)).toBeNull();
    expect(buildHardeningConfig(undefined)).toBeNull();
  });

  test('builds a one-item array with the camelCase kind and the severity as-is', () => {
    expect(buildHardeningConfig({ noResult: { enabled: true, severity: 'Error' } })).toEqual([
      { kind: 'noResult', severity: 'Error' },
    ]);
    expect(buildHardeningConfig({ noResult: { enabled: true, severity: 'Warning' } })).toEqual([
      { kind: 'noResult', severity: 'Warning' },
    ]);
  });
});

describe('buildScrapingConfig (hardening, Issue #129)', () => {
  test('omits hardening entirely when disabled (the default)', () => {
    const result = buildScrapingConfig('https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }]);
    expect(result.hardening).toBeUndefined();
  });

  test('includes hardening when enabled and configured', () => {
    const hardening = { noResult: { enabled: true, severity: 'Error' } };
    const result = buildScrapingConfig(
      'https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }], [], null, null, null, 'Static', [], false,
      false, [], null, null, hardening,
    );
    expect(result.hardening).toEqual([{ kind: 'noResult', severity: 'Error' }]);
  });

  test('works the same way for container and api modes', () => {
    const hardening = { noResult: { enabled: true, severity: 'Warning' } };
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig(
      'https://example.com', 'container', [], groups, null, null, null, 'Static', [], false, false, [], null, null,
      hardening,
    );
    expect(containerResult.hardening).toEqual([{ kind: 'noResult', severity: 'Warning' }]);

    const apiResult = buildScrapingConfig(
      'https://example.com', 'api', [], [], { fields: [] }, null, null, 'Static', [], false, false, [], null, null,
      hardening,
    );
    expect(apiResult.hardening).toEqual([{ kind: 'noResult', severity: 'Warning' }]);
  });
});

// Issue #130
describe('buildHardeningConfig (nullRate)', () => {
  test('omits an incomplete row (no field chosen)', () => {
    expect(buildHardeningConfig({ nullRate: [{ fieldName: '', threshold: 30, severity: 'Warning' }] })).toBeNull();
  });

  test('converts the percent threshold into a 0.0-1.0 fraction', () => {
    expect(buildHardeningConfig({ nullRate: [{ fieldName: 'Preis', threshold: 30, severity: 'Error' }] })).toEqual([
      { kind: 'nullRate', severity: 'Error', fieldName: 'Preis', threshold: 0.3 },
    ]);
  });

  test('clamps an out-of-range or non-numeric threshold, defaulting to 50%', () => {
    expect(buildHardeningConfig({ nullRate: [{ fieldName: 'A', threshold: 150, severity: 'Warning' }] })).toEqual([
      { kind: 'nullRate', severity: 'Warning', fieldName: 'A', threshold: 1 },
    ]);
    expect(buildHardeningConfig({ nullRate: [{ fieldName: 'A', threshold: -20, severity: 'Warning' }] })).toEqual([
      { kind: 'nullRate', severity: 'Warning', fieldName: 'A', threshold: 0 },
    ]);
    expect(buildHardeningConfig({ nullRate: [{ fieldName: 'A', threshold: NaN, severity: 'Warning' }] })).toEqual([
      { kind: 'nullRate', severity: 'Warning', fieldName: 'A', threshold: 0.5 },
    ]);
  });

  test('combines multiple complete rows with noResult', () => {
    const hardening = {
      noResult: { enabled: true, severity: 'Error' },
      nullRate: [
        { fieldName: 'Preis', threshold: 30, severity: 'Error' },
        { fieldName: '', threshold: 10, severity: 'Warning' }, // incomplete, skipped
        { fieldName: 'Titel', threshold: 10, severity: 'Warning' },
      ],
    };
    expect(buildHardeningConfig(hardening)).toEqual([
      { kind: 'noResult', severity: 'Error' },
      { kind: 'nullRate', severity: 'Error', fieldName: 'Preis', threshold: 0.3 },
      { kind: 'nullRate', severity: 'Warning', fieldName: 'Titel', threshold: 0.1 },
    ]);
  });

  test('returns null when everything is empty/disabled', () => {
    expect(buildHardeningConfig({ noResult: { enabled: false, severity: 'Warning' }, nullRate: [] })).toBeNull();
  });
});

// Issue #131
describe('buildHardeningConfig (baseline)', () => {
  test('returns null when baseline is disabled', () => {
    expect(buildHardeningConfig({ baseline: { enabled: false, severity: 'Warning', dropThresholdPercent: 20 } })).toBeNull();
  });

  test('converts dropThresholdPercent into a 0.0-1.0 fraction', () => {
    expect(buildHardeningConfig({ baseline: { enabled: true, severity: 'Error', dropThresholdPercent: 20 } })).toEqual([
      { kind: 'baseline', severity: 'Error', dropThreshold: 0.2 },
    ]);
  });

  test('clamps an out-of-range or non-numeric percent, defaulting to 20%', () => {
    expect(buildHardeningConfig({ baseline: { enabled: true, severity: 'Warning', dropThresholdPercent: 150 } })).toEqual([
      { kind: 'baseline', severity: 'Warning', dropThreshold: 1 },
    ]);
    expect(buildHardeningConfig({ baseline: { enabled: true, severity: 'Warning', dropThresholdPercent: -10 } })).toEqual([
      { kind: 'baseline', severity: 'Warning', dropThreshold: 0 },
    ]);
    expect(buildHardeningConfig({ baseline: { enabled: true, severity: 'Warning', dropThresholdPercent: NaN } })).toEqual([
      { kind: 'baseline', severity: 'Warning', dropThreshold: 0.2 },
    ]);
  });

  test('combines with noResult and nullRate', () => {
    const hardening = {
      noResult: { enabled: true, severity: 'Error' },
      nullRate: [{ fieldName: 'Preis', threshold: 30, severity: 'Error' }],
      baseline: { enabled: true, severity: 'Warning', dropThresholdPercent: 20 },
    };
    expect(buildHardeningConfig(hardening)).toEqual([
      { kind: 'noResult', severity: 'Error' },
      { kind: 'nullRate', severity: 'Error', fieldName: 'Preis', threshold: 0.3 },
      { kind: 'baseline', severity: 'Warning', dropThreshold: 0.2 },
    ]);
  });
});

describe('buildScrapingConfig (baseline hardening, Issue #131)', () => {
  test('threads a baseline check through the wire config', () => {
    const hardening = { baseline: { enabled: true, severity: 'Error', dropThresholdPercent: 25 } };
    const result = buildScrapingConfig(
      'https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }], [], null, null, null, 'Static', [], false,
      false, [], null, null, hardening,
    );
    expect(result.hardening).toEqual([{ kind: 'baseline', severity: 'Error', dropThreshold: 0.25 }]);
  });
});

// Issue #132
describe('buildHardeningConfig (blocking)', () => {
  test('returns null when blocking is disabled', () => {
    expect(buildHardeningConfig({ blocking: { enabled: false, severity: 'Warning', minBodyLengthText: '', phrasesText: '' } })).toBeNull();
  });

  test('includes minBodyLength and blockPhrases when both are set', () => {
    const hardening = { blocking: { enabled: true, severity: 'Error', minBodyLengthText: '200', phrasesText: 'Access Denied\nPlease verify you are human' } };
    expect(buildHardeningConfig(hardening)).toEqual([
      { kind: 'blocking', severity: 'Error', minBodyLength: 200, blockPhrases: ['Access Denied', 'Please verify you are human'] },
    ]);
  });

  // Unlike nullRate, there's no "at least one signal configured"
  // requirement — the cross-origin-redirect signal is always active, so an
  // enabled BlockingCheck with neither field filled in is still valid.
  test('omits minBodyLength (null) and blockPhrases (empty array) when both are blank', () => {
    const hardening = { blocking: { enabled: true, severity: 'Warning', minBodyLengthText: '', phrasesText: '' } };
    expect(buildHardeningConfig(hardening)).toEqual([
      { kind: 'blocking', severity: 'Warning', minBodyLength: null, blockPhrases: [] },
    ]);
  });

  test('treats a non-positive or non-numeric minBodyLengthText as unset', () => {
    expect(buildHardeningConfig({ blocking: { enabled: true, severity: 'Warning', minBodyLengthText: '0', phrasesText: '' } })).toEqual([
      { kind: 'blocking', severity: 'Warning', minBodyLength: null, blockPhrases: [] },
    ]);
    expect(buildHardeningConfig({ blocking: { enabled: true, severity: 'Warning', minBodyLengthText: 'not a number', phrasesText: '' } })).toEqual([
      { kind: 'blocking', severity: 'Warning', minBodyLength: null, blockPhrases: [] },
    ]);
  });

  // One phrase per line (not comma-split like API mode's value list) —
  // blank lines are dropped, a comma inside a phrase is preserved verbatim.
  test('splits phrasesText on newlines only, dropping blank lines', () => {
    const hardening = { blocking: { enabled: true, severity: 'Warning', minBodyLengthText: '', phrasesText: 'Access Denied\n\n  \nRate limit, try again later' } };
    expect(buildHardeningConfig(hardening)).toEqual([
      { kind: 'blocking', severity: 'Warning', minBodyLength: null, blockPhrases: ['Access Denied', 'Rate limit, try again later'] },
    ]);
  });

  test('combines with noResult, nullRate, and baseline', () => {
    const hardening = {
      noResult: { enabled: true, severity: 'Error' },
      nullRate: [{ fieldName: 'Preis', threshold: 30, severity: 'Error' }],
      baseline: { enabled: true, severity: 'Warning', dropThresholdPercent: 20 },
      blocking: { enabled: true, severity: 'Error', minBodyLengthText: '200', phrasesText: 'Access Denied' },
    };
    expect(buildHardeningConfig(hardening)).toEqual([
      { kind: 'noResult', severity: 'Error' },
      { kind: 'nullRate', severity: 'Error', fieldName: 'Preis', threshold: 0.3 },
      { kind: 'baseline', severity: 'Warning', dropThreshold: 0.2 },
      { kind: 'blocking', severity: 'Error', minBodyLength: 200, blockPhrases: ['Access Denied'] },
    ]);
  });
});

describe('buildScrapingConfig (blocking hardening, Issue #132)', () => {
  test('threads a blocking check through the wire config', () => {
    const hardening = { blocking: { enabled: true, severity: 'Error', minBodyLengthText: '200', phrasesText: 'Access Denied' } };
    const result = buildScrapingConfig(
      'https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }], [], null, null, null, 'Static', [], false,
      false, [], null, null, hardening,
    );
    expect(result.hardening).toEqual([{ kind: 'blocking', severity: 'Error', minBodyLength: 200, blockPhrases: ['Access Denied'] }]);
  });
});

// Issue #133
describe('addRequiredField / removeRequiredField', () => {
  test('adds a field name', () => {
    expect(addRequiredField(['Titel'], 'Preis')).toEqual(['Titel', 'Preis']);
  });

  test('adding an already-present field name is a no-op', () => {
    expect(addRequiredField(['Titel', 'Preis'], 'Preis')).toEqual(['Titel', 'Preis']);
  });

  test('adding a blank/undefined field name is a no-op', () => {
    expect(addRequiredField(['Titel'], '')).toEqual(['Titel']);
    expect(addRequiredField(['Titel'], undefined)).toEqual(['Titel']);
  });

  test('removes a field name by index', () => {
    expect(removeRequiredField(['Titel', 'Preis', 'Menge'], 1)).toEqual(['Titel', 'Menge']);
  });
});

describe('buildHardeningConfig (requiredFields)', () => {
  test('returns null when disabled', () => {
    expect(buildHardeningConfig({ requiredFields: { enabled: false, severity: 'Warning', fields: ['Titel'] } })).toBeNull();
  });

  // Unlike blocking (still meaningful with nothing configured, thanks to
  // its always-on redirect signal), an enabled requiredFields check with no
  // fields chosen yet has nothing to do at all — same "incomplete draft,
  // not sent" convention as an unfinished nullRate row.
  test('returns null when enabled but no fields chosen yet', () => {
    expect(buildHardeningConfig({ requiredFields: { enabled: true, severity: 'Warning', fields: [] } })).toBeNull();
  });

  test('includes the configured field names and shared severity', () => {
    const hardening = { requiredFields: { enabled: true, severity: 'Error', fields: ['Titel', 'Preis'] } };
    expect(buildHardeningConfig(hardening)).toEqual([
      { kind: 'requiredFields', severity: 'Error', fieldNames: ['Titel', 'Preis'] },
    ]);
  });

  test('combines with the other four checks', () => {
    const hardening = {
      noResult: { enabled: true, severity: 'Error' },
      nullRate: [{ fieldName: 'Preis', threshold: 30, severity: 'Error' }],
      baseline: { enabled: true, severity: 'Warning', dropThresholdPercent: 20 },
      blocking: { enabled: true, severity: 'Error', minBodyLengthText: '200', phrasesText: 'Access Denied' },
      requiredFields: { enabled: true, severity: 'Error', fields: ['Titel'] },
    };
    expect(buildHardeningConfig(hardening)).toEqual([
      { kind: 'noResult', severity: 'Error' },
      { kind: 'nullRate', severity: 'Error', fieldName: 'Preis', threshold: 0.3 },
      { kind: 'baseline', severity: 'Warning', dropThreshold: 0.2 },
      { kind: 'blocking', severity: 'Error', minBodyLength: 200, blockPhrases: ['Access Denied'] },
      { kind: 'requiredFields', severity: 'Error', fieldNames: ['Titel'] },
    ]);
  });
});

describe('buildScrapingConfig (requiredFields hardening, Issue #133)', () => {
  test('threads a requiredFields check through the wire config', () => {
    const hardening = { requiredFields: { enabled: true, severity: 'Error', fields: ['Titel'] } };
    const result = buildScrapingConfig(
      'https://example.com', 'flat', [{ name: 'Titel', selector: 'h1' }], [], null, null, null, 'Static', [], false,
      false, [], null, null, hardening,
    );
    expect(result.hardening).toEqual([{ kind: 'requiredFields', severity: 'Error', fieldNames: ['Titel'] }]);
  });
});

// Issue #183
describe('computeInitialMonitoringSectionOpen', () => {
  const allDisabledHardening = {
    noResult: { enabled: false, severity: 'Warning' },
    nullRate: [],
    baseline: { enabled: false, severity: 'Warning', dropThresholdPercent: 20 },
    blocking: { enabled: false, severity: 'Warning', minBodyLengthText: '', phrasesText: '' },
    requiredFields: { enabled: false, severity: 'Warning', fields: [] },
  };

  test('returns false when neither change detection nor any hardening check is configured', () => {
    expect(computeInitialMonitoringSectionOpen(null, allDisabledHardening)).toBe(false);
  });

  test('returns true when change detection is configured', () => {
    const changeDetection = {
      enabled: true, notify: 'Webhook', email: null, webhook: { urlEnvVar: 'SF_WEBHOOK' },
    };
    expect(computeInitialMonitoringSectionOpen(changeDetection, allDisabledHardening)).toBe(true);
  });

  test('returns true when a hardening check is configured', () => {
    const hardening = { ...allDisabledHardening, noResult: { enabled: true, severity: 'Error' } };
    expect(computeInitialMonitoringSectionOpen(null, hardening)).toBe(true);
  });

  // An enabled-but-incomplete draft (e.g. change detection toggled on but
  // its required fields still blank) is exactly what
  // buildChangeDetectionConfig/buildHardeningConfig already treat as "not
  // actually configured" — reusing that logic means this stays consistent
  // automatically, with no separate "is it complete" check duplicated here.
  test('returns false for an enabled-but-incomplete change-detection draft', () => {
    const changeDetection = {
      enabled: true, notify: 'Webhook', email: null, webhook: { urlEnvVar: '' },
    };
    expect(computeInitialMonitoringSectionOpen(changeDetection, allDisabledHardening)).toBe(false);
  });

  test('returns false for an enabled-but-empty requiredFields draft', () => {
    const hardening = { ...allDisabledHardening, requiredFields: { enabled: true, severity: 'Warning', fields: [] } };
    expect(computeInitialMonitoringSectionOpen(null, hardening)).toBe(false);
  });
});

describe('collectFieldNames (Issue #130)', () => {
  test('flat mode: reads field names straight off the fields array', () => {
    const fields = [{ name: 'Titel', selector: 'h1' }, { name: 'Preis', selector: '.price' }];
    expect(collectFieldNames('flat', fields, [], null)).toEqual(['Titel', 'Preis']);
  });

  test('container mode: walks the live draft tree, deduplicating repeated leaf names', () => {
    const groups = [
      {
        kind: 'group', name: 'Kategorie', children: [
          { kind: 'field', name: 'Titel' },
          { kind: 'field', name: 'Preis' },
          {
            kind: 'group', name: 'Unterkategorie', children: [
              { kind: 'field', name: 'Preis' }, // same leaf name, nested deeper
            ],
          },
        ],
      },
    ];
    expect(collectFieldNames('container', [], groups, null)).toEqual(['Titel', 'Preis']);
  });

  test('api mode, flat shape: reads apiConfig.fields', () => {
    const apiConfig = { fields: [{ name: 'Titel' }, { name: 'Preis' }] };
    expect(collectFieldNames('api', [], [], apiConfig)).toEqual(['Titel', 'Preis']);
  });

  test('api mode, tree shape: walks the serialized apiConfig.groups (structural children discriminator)', () => {
    const apiConfig = {
      groups: [
        {
          name: 'Kategorie', path: 'categories[*]', children: [
            { name: 'Titel', path: 'name' },
            { name: 'Unterkategorie', path: 'items[*]', children: [{ name: 'Preis', path: 'price' }] },
          ],
        },
      ],
    };
    expect(collectFieldNames('api', [], [], apiConfig)).toEqual(['Titel', 'Preis']);
  });

  test('returns an empty array when there is nothing configured yet', () => {
    expect(collectFieldNames('flat', [], [], null)).toEqual([]);
    expect(collectFieldNames('container', [], [], null)).toEqual([]);
    expect(collectFieldNames('api', [], [], null)).toEqual([]);
  });
});

describe('addNullRateCheck / removeNullRateCheck / updateNullRateCheck (Issue #130)', () => {
  test('addNullRateCheck appends a row with a default 50% threshold and Warning severity', () => {
    expect(addNullRateCheck([], 'Preis')).toEqual([{ fieldName: 'Preis', threshold: 50, severity: 'Warning' }]);
  });

  test('addNullRateCheck tolerates no field chosen yet', () => {
    expect(addNullRateCheck([], undefined)).toEqual([{ fieldName: '', threshold: 50, severity: 'Warning' }]);
  });

  test('removeNullRateCheck drops the row at the given index only', () => {
    const rows = [
      { fieldName: 'A', threshold: 10, severity: 'Warning' },
      { fieldName: 'B', threshold: 20, severity: 'Error' },
    ];
    expect(removeNullRateCheck(rows, 0)).toEqual([{ fieldName: 'B', threshold: 20, severity: 'Error' }]);
  });

  test('updateNullRateCheck patches only the targeted row, leaving others untouched', () => {
    const rows = [
      { fieldName: 'A', threshold: 10, severity: 'Warning' },
      { fieldName: 'B', threshold: 20, severity: 'Error' },
    ];
    expect(updateNullRateCheck(rows, 1, { severity: 'Warning' })).toEqual([
      { fieldName: 'A', threshold: 10, severity: 'Warning' },
      { fieldName: 'B', threshold: 20, severity: 'Warning' },
    ]);
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
    expect(result).toEqual([{ name: 'Titel', selector: 'h1', attribute: null, framePath: null, transforms: null }]);
  });

  // Issue #42, Phase 7
  test('appends field with framePath when given', () => {
    const result = addField([], 'Preis', 'h2', ['#price-widget']);
    expect(result).toEqual([{ name: 'Preis', selector: 'h2', attribute: null, framePath: ['#price-widget'], transforms: null }]);
  });

  // Issue #84
  test('appends field with transforms when given', () => {
    const transforms = [{ kind: 'trim' }, { kind: 'toNumber' }];
    const result = addField([], 'Preis', '.price', null, transforms);
    expect(result).toEqual([{ name: 'Preis', selector: '.price', attribute: null, framePath: null, transforms }]);
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

