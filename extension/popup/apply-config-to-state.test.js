require('./test-support/popup-env');
const {
  buildScrapingConfig,
  buildGroupNode,
  buildFieldNode,
  buildConfigExport,
  applyConfigToState,
} = require('./popup');



// ── applyConfigToState (Issue #141) ─────────────────────────────────────────
// The reverse of buildScrapingConfig/buildConfigExport — round-tripping a
// built wire config through applyConfigToState should reproduce every part
// of _state buildScrapingConfig itself reads, for every mode/shape.

describe('applyConfigToState', () => {
  test('never includes `url` — the live browser tab stays authoritative', () => {
    const config = buildScrapingConfig({
      url: 'https://example.com/products',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
    });
    expect(applyConfigToState(config)).not.toHaveProperty('url');
  });

  test('flat mode: round-trips fields (with attribute/framePath/transforms), scriptFileName/outputFileName, additionalStartUrls', () => {
    const fields = [
      { name: 'Titel', selector: 'h1', attribute: null, framePath: null, transforms: null, download: false, maxDownloadSizeBytes: null, allowedContentTypes: [], hiddenFromOutput: false },
      { name: 'Bild', selector: 'img', attribute: 'src', framePath: ['#widget'], transforms: [{ kind: 'trim' }], download: false, maxDownloadSizeBytes: null, allowedContentTypes: [], hiddenFromOutput: false },
    ];
    const config = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields,
      scriptFileName: 'myscraper',
      outputFileName: 'result',
      useJsonOutput: true,
      additionalUrls: ['https://example.com/page2'],
    });

    const result = applyConfigToState(config);

    expect(result.mode).toBe('flat');
    expect(result.fields).toEqual(fields);
    expect(result.groups).toEqual([]);
    expect(result.apiConfig).toBeNull();
    expect(result.scriptFileName).toBe('myscraper');
    expect(result.outputFileName).toBe('result');
    // useJsonOutput moved off per-scrape state to the global Settings tab
    // (shared/global-settings.ts) — applyConfigToState no longer touches it
    // at all, so a loaded/exported config never stomps that preference.
    expect(result).not.toHaveProperty('useJsonOutput');
    expect(result.additionalStartUrls).toEqual(['https://example.com/page2']);
  });

  // Issue #214
  test('flat mode: round-trips a downloading field with its safety net', () => {
    const fields = [
      {
        name: 'Datei', selector: 'a.file', attribute: 'href', framePath: null, transforms: null,
        download: true, maxDownloadSizeBytes: 1024, allowedContentTypes: ['application/pdf'], hiddenFromOutput: false,
      },
    ];
    const config = buildScrapingConfig({ url: 'https://example.com', mode: 'flat', fields });
    expect(applyConfigToState(config).fields).toEqual(fields);
  });

  test('container mode: round-trips a nested group tree through serialize/deserialize', () => {
    const inner = buildFieldNode('Preis', '.price', 'attribute', 'data-price');
    const group = { ...buildGroupNode('Kategorie', 'section.menu-category', true), children: [inner] };
    const config = buildScrapingConfig({ url: 'https://example.com', mode: 'container', groups: [group] });

    const result = applyConfigToState(config);

    expect(result.mode).toBe('container');
    expect(result.fields).toEqual([]);
    expect(result.groups).toEqual([group]);
  });

  test('container mode: round-trips every field extraction mode (text/attribute/exists/ownText)', () => {
    const groups = [
      buildFieldNode('Titel', 'h3', 'text'),
      buildFieldNode('Link', 'a', 'attribute', 'href'),
      buildFieldNode('Vorhanden', '.badge', 'exists'),
      buildFieldNode('Name', 'h2', 'ownText'),
    ];
    const config = buildScrapingConfig({ url: 'https://example.com', mode: 'container', groups });

    expect(applyConfigToState(config).groups).toEqual(groups);
  });

  test('api mode: passes apiConfig through unchanged', () => {
    const apiConfig = { urlTemplate: 'https://example.com/api/{id}', itemsPath: 'data', fields: [{ name: 'Titel', path: 'title' }], parameters: [] };
    const config = buildScrapingConfig({ url: 'https://example.com', mode: 'api', apiConfig });

    const result = applyConfigToState(config);

    expect(result.mode).toBe('api');
    expect(result.apiConfig).toEqual(apiConfig);
    expect(result.fields).toEqual([]);
    expect(result.groups).toEqual([]);
  });

  test('round-trips engine + browserActions (all four kinds, including framePath)', () => {
    const browserActions = [
      { kind: 'waitFor', selector: '.ready', timeoutMs: 3000, framePath: ['#frame1'] },
      { kind: 'fill', selector: '#user', environmentVariableName: 'SF_USER', framePath: null },
      { kind: 'click', selector: '#submit', framePath: null, target: 'first', waitAfterMs: 250 },
      { kind: 'scroll', containerSelector: '.list', loadMoreButtonSelector: '.more', maxIterations: 5, waitAfterMs: 500, framePath: null },
    ];
    const config = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      engine: 'Browser',
      browserActions,
    });

    const result = applyConfigToState(config);

    expect(result.engine).toBe('Browser');
    expect(result.browserActions).toEqual(browserActions);
  });

  test('defaults engine to Static and browserActions to [] when omitted (Static-engine wire config)', () => {
    const config = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
    });
    const result = applyConfigToState(config);
    expect(result.engine).toBe('Static');
    expect(result.browserActions).toEqual([]);
  });

  test('round-trips changeDetection (webhook) and proxy', () => {
    const changeDetection = {
      enabled: true, notify: 'Webhook',
      email: { smtpHostEnvVar: '', smtpPortEnvVar: '', smtpUsernameEnvVar: '', smtpPasswordEnvVar: '', fromEnvVar: '', toEnvVar: '' },
      webhook: { urlEnvVar: 'SF_WEBHOOK_URL' },
    };
    const proxy = { enabled: true, envVar: 'SF_PROXIES' };
    const config = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      changeDetection,
      proxy,
    });

    const result = applyConfigToState(config);

    expect(result.changeDetection).toEqual(changeDetection);
    expect(result.proxy).toEqual(proxy);
  });

  test('round-trips changeDetection (email, with only required fields set)', () => {
    const changeDetection = {
      enabled: true, notify: 'Email',
      email: { smtpHostEnvVar: 'SF_HOST', smtpPortEnvVar: '', smtpUsernameEnvVar: '', smtpPasswordEnvVar: '', fromEnvVar: 'SF_FROM', toEnvVar: 'SF_TO' },
      webhook: { urlEnvVar: '' },
    };
    const config = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      changeDetection,
    });

    expect(applyConfigToState(config).changeDetection).toEqual(changeDetection);
  });

  test('defaults changeDetection/proxy to their disabled shape when omitted', () => {
    const config = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
    });
    const result = applyConfigToState(config);
    expect(result.changeDetection).toEqual({
      enabled: false, notify: 'Email',
      email: { smtpHostEnvVar: '', smtpPortEnvVar: '', smtpUsernameEnvVar: '', smtpPasswordEnvVar: '', fromEnvVar: '', toEnvVar: '' },
      webhook: { urlEnvVar: '' },
    });
    expect(result.proxy).toEqual({ enabled: false, envVar: '' });
  });

  test('round-trips pagination (both kinds) and persistentSession', () => {
    const pagination = { enabled: true, kind: 'pageNumber', nextLinkSelector: '', urlTemplate: '{url}?page={page}', maxPages: 10 };
    const config = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      engine: 'Browser',
      pagination,
      persistentSession: true,
    });

    const result = applyConfigToState(config);

    expect(result.pagination).toEqual(pagination);
    expect(result.persistentSession).toBe(true);
  });

  test('defaults pagination to disabled/nextLink and persistentSession to false when omitted', () => {
    const config = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
    });
    const result = applyConfigToState(config);
    expect(result.pagination).toEqual({ enabled: false, kind: 'nextLink', nextLinkSelector: '', urlTemplate: '', maxPages: 50 });
    expect(result.persistentSession).toBe(false);
  });

  // Issue #178 / Issue-driven follow-up: externalConfig moved off per-scrape
  // state to the global Settings tab (shared/global-settings.ts) —
  // applyConfigToState no longer touches it at all, regardless of whether
  // the loaded/exported config itself had it set.
  test('never round-trips externalConfig — it is a global preference now', () => {
    const config = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      externalConfig: true,
    });
    expect(applyConfigToState(config)).not.toHaveProperty('externalConfig');
  });

  test('round-trips every hardening check kind', () => {
    const hardening = {
      noResult: { enabled: true, severity: 'Error' },
      nullRate: [{ fieldName: 'Preis', threshold: 30, severity: 'Error' }],
      baseline: { enabled: true, severity: 'Warning', dropThresholdPercent: 25 },
      blocking: { enabled: true, severity: 'Warning', minBodyLengthText: '500', phrasesText: 'Access Denied\nCAPTCHA' },
      requiredFields: { enabled: true, severity: 'Error', fields: ['Titel', 'Preis'] },
    };
    const config = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      hardening,
    });

    expect(applyConfigToState(config).hardening).toEqual(hardening);
  });

  test('defaults hardening to its fully-disabled shape when omitted', () => {
    const config = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
    });
    expect(applyConfigToState(config).hardening).toEqual({
      noResult: { enabled: false, severity: 'Warning' },
      nullRate: [],
      baseline: { enabled: false, severity: 'Warning', dropThresholdPercent: 20 },
      blocking: { enabled: false, severity: 'Warning', minBodyLengthText: '', phrasesText: '' },
      requiredFields: { enabled: false, severity: 'Warning', fields: [] },
    });
  });
});
