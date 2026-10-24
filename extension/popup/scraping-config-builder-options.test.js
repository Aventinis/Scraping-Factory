// Renders translated copy via i18n's t(), so a real dictionary has to be loaded.
global.chrome = global.chrome || { storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } } };
const { initI18n } = require('../i18n/i18n');
beforeAll(() => initI18n('de-DE'));

const {
  buildScrapingConfig,
  buildChangeDetectionConfig,
  buildProxyConfig,
  buildPaginationConfig,
  buildDiscoveredUrlsConfig,
} = require('./scraping-config-builder');
const { buildGroupNode } = require('./container-tree');

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
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
    });
    expect(result.changeDetection).toBeUndefined();
  });

  test('includes changeDetection when enabled and fully configured', () => {
    const changeDetection = {
      enabled: true, notify: 'Webhook',
      email: { smtpHostEnvVar: '', smtpPortEnvVar: '', smtpUsernameEnvVar: '', smtpPasswordEnvVar: '', fromEnvVar: '', toEnvVar: '' },
      webhook: { urlEnvVar: 'SF_WEBHOOK_URL' },
    };
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      changeDetection,
    });
    expect(result.changeDetection).toEqual({ notify: 'Webhook', webhook: { urlEnvVar: 'SF_WEBHOOK_URL' } });
  });

  test('works the same way for container and api modes', () => {
    const changeDetection = {
      enabled: true, notify: 'Webhook',
      email: { smtpHostEnvVar: '', smtpPortEnvVar: '', smtpUsernameEnvVar: '', smtpPasswordEnvVar: '', fromEnvVar: '', toEnvVar: '' },
      webhook: { urlEnvVar: 'SF_WEBHOOK_URL' },
    };
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig({ url: 'https://example.com', mode: 'container', groups, changeDetection });
    expect(containerResult.changeDetection).toEqual({ notify: 'Webhook', webhook: { urlEnvVar: 'SF_WEBHOOK_URL' } });

    const apiResult = buildScrapingConfig({ url: 'https://example.com', mode: 'api', apiConfig: { fields: [] }, changeDetection });
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
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
    });
    expect(result.proxy).toBeUndefined();
  });

  test('includes proxy when enabled and configured', () => {
    const proxy = { enabled: true, envVar: 'SF_PROXIES' };
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      proxy,
    });
    expect(result.proxy).toEqual({ environmentVariableName: 'SF_PROXIES' });
  });

  test('works the same way for container and api modes', () => {
    const proxy = { enabled: true, envVar: 'SF_PROXIES' };
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig({ url: 'https://example.com', mode: 'container', groups, proxy });
    expect(containerResult.proxy).toEqual({ environmentVariableName: 'SF_PROXIES' });

    const apiResult = buildScrapingConfig({ url: 'https://example.com', mode: 'api', apiConfig: { fields: [] }, proxy });
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

describe('buildDiscoveredUrlsConfig (Issue #218)', () => {
  test('returns null when disabled', () => {
    expect(buildDiscoveredUrlsConfig({ enabled: false, pageUrl: 'https://example.com/nav', linkSelector: 'a', maxUrls: 100 })).toBeNull();
  });

  test('returns null for null/undefined input', () => {
    expect(buildDiscoveredUrlsConfig(null)).toBeNull();
    expect(buildDiscoveredUrlsConfig(undefined)).toBeNull();
  });

  test('returns null when pageUrl is blank', () => {
    expect(buildDiscoveredUrlsConfig({ enabled: true, pageUrl: '', linkSelector: 'a', maxUrls: 100 })).toBeNull();
    expect(buildDiscoveredUrlsConfig({ enabled: true, pageUrl: '   ', linkSelector: 'a', maxUrls: 100 })).toBeNull();
  });

  test('returns null when linkSelector is blank', () => {
    expect(buildDiscoveredUrlsConfig({ enabled: true, pageUrl: 'https://example.com/nav', linkSelector: '', maxUrls: 100 })).toBeNull();
  });

  test('builds the wire shape with trimmed pageUrl/linkSelector', () => {
    expect(buildDiscoveredUrlsConfig({
      enabled: true, pageUrl: '  https://example.com/nav  ', linkSelector: '  nav.categories a  ', maxUrls: 50,
    })).toEqual({ pageUrl: 'https://example.com/nav', linkSelector: 'nav.categories a', maxUrls: 50 });
  });

  test('clamps/defaults an invalid maxUrls to 100', () => {
    for (const invalid of [0, NaN, -5]) {
      expect(buildDiscoveredUrlsConfig({ enabled: true, pageUrl: 'https://example.com/nav', linkSelector: 'a', maxUrls: invalid })).toEqual({
        pageUrl: 'https://example.com/nav', linkSelector: 'a', maxUrls: 100,
      });
    }
  });

  test('floors a fractional maxUrls', () => {
    expect(buildDiscoveredUrlsConfig({ enabled: true, pageUrl: 'https://example.com/nav', linkSelector: 'a', maxUrls: 12.7 })).toEqual({
      pageUrl: 'https://example.com/nav', linkSelector: 'a', maxUrls: 12,
    });
  });
});

describe('buildScrapingConfig (pagination, Issue #174)', () => {
  test('omits pagination entirely when disabled (the default)', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
    });
    expect(result.pagination).toBeUndefined();
  });

  test('includes pagination when enabled and configured', () => {
    const pagination = { enabled: true, kind: 'nextLink', nextLinkSelector: 'a.next', maxPages: 30 };
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      pagination,
    });
    expect(result.pagination).toEqual({ kind: 'nextLink', nextLinkSelector: 'a.next', maxPages: 30 });
  });

  test('works the same way for container mode', () => {
    const pagination = { enabled: true, kind: 'pageNumber', urlTemplate: '{url}?page={page}', maxPages: 10 };
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig({ url: 'https://example.com', mode: 'container', groups, pagination });
    expect(containerResult.pagination).toEqual({ kind: 'pageNumber', urlTemplate: '{url}?page={page}', maxPages: 10 });
  });
});

// Issue #218: discoveredUrls is appended as the very last positional
// parameter (see buildScrapingConfig's own doc comment on why), so these
// calls explicitly spell out every intervening default rather than relying
// on them — unlike every other integration test in this file, which only
// ever needs to reach as far as the one parameter it's testing.
describe('buildScrapingConfig (discoveredUrls, Issue #218)', () => {
  test('omits discoveredUrls entirely when disabled (the default)', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
    });
    expect(result.discoveredUrls).toBeUndefined();
  });

  test('includes discoveredUrls when enabled and configured', () => {
    const discoveredUrls = { enabled: true, pageUrl: 'https://example.com/nav', linkSelector: 'nav a', maxUrls: 20 };
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      discoveredUrls,
    });
    expect(result.discoveredUrls).toEqual({ pageUrl: 'https://example.com/nav', linkSelector: 'nav a', maxUrls: 20 });
  });

  test('works the same way for container mode', () => {
    const discoveredUrls = { enabled: true, pageUrl: 'https://example.com/nav', linkSelector: 'nav a', maxUrls: 20 };
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig({ url: 'https://example.com', mode: 'container', groups, discoveredUrls });
    expect(containerResult.discoveredUrls).toEqual({ pageUrl: 'https://example.com/nav', linkSelector: 'nav a', maxUrls: 20 });
  });
});

// Issue #219: preflight is appended as the very last positional parameter
// (after discoveredUrls, see buildScrapingConfig's own doc comment), same
// "spell out every intervening default" style as the discoveredUrls tests
// just above.
describe('buildScrapingConfig (preflight, Issue #219)', () => {
  test('omits preflight entirely when disabled (the default)', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
    });
    expect(result.preflight).toBeUndefined();
  });

  test('includes preflight: true when enabled', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      preflight: true,
    });
    expect(result.preflight).toBe(true);
  });

  test('works the same way for container mode', () => {
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig({ url: 'https://example.com', mode: 'container', groups, preflight: true });
    expect(containerResult.preflight).toBe(true);
  });
});

// Issue #175
describe('buildScrapingConfig (persistentSession, Issue #175)', () => {
  test('omits persistentSession entirely when false (the default)', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
    });
    expect(result.persistentSession).toBeUndefined();
  });

  test('includes persistentSession: true when enabled', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      engine: 'Browser',
      persistentSession: true,
    });
    expect(result.persistentSession).toBe(true);
  });

  test('works the same way for container and api modes', () => {
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'container',
      groups,
      engine: 'Browser',
      persistentSession: true,
    });
    expect(containerResult.persistentSession).toBe(true);

    const apiResult = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'api',
      apiConfig: { fields: [] },
      engine: 'Browser',
      persistentSession: true,
    });
    expect(apiResult.persistentSession).toBe(true);
  });
});

// Issue #178
describe('buildScrapingConfig (externalConfig)', () => {
  test('omits externalConfig entirely when false (the default)', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
    });
    expect(result.externalConfig).toBeUndefined();
  });

  test('includes externalConfig: true when enabled', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      externalConfig: true,
    });
    expect(result.externalConfig).toBe(true);
  });

  test('works the same way for container and api modes', () => {
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig({ url: 'https://example.com', mode: 'container', groups, externalConfig: true });
    expect(containerResult.externalConfig).toBe(true);

    const apiResult = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'api',
      apiConfig: { fields: [] },
      externalConfig: true,
    });
    expect(apiResult.externalConfig).toBe(true);
  });
});
