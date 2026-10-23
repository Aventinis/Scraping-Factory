// Issue #388: wire-format contract, extension half. For a matrix of popup states, the REAL request builders
// (buildScrapingConfig and the api-config/container-tree/... helpers it relies on) produce the body /generate would
// receive; each is compared byte for byte with test-vectors/wire/<id>.json. The companion half
// (companion/ScrapingFactory.Tests/WireFixtureTests.cs) reads the same files, deserializes them strictly into the
// real ScrapingConfig (an unknown property fails) and sends them through /generate. A change on either side that
// the other does not follow therefore fails a test, without a browser.
//
// A changed builder output is accepted with:  UPDATE_WIRE_FIXTURES=1 npx jest popup/wire-fixtures
// and reviewed in the diff of test-vectors/wire/ like any other code change.
const fs = require('fs');
const path = require('path');
const { buildScrapingConfig, addBrowserAction, updateBrowserAction } = require('./scraping-config-builder');
const { buildGroupNode, buildFieldNode, insertContainerNode } = require('./container-tree');
const {
  buildApiConfig, parseUrlTemplateParts, buildStaticListSource, buildRangeSource, buildDiscoverySource, buildBrowserDiscoverySource,
  buildApiGroupDraft, buildApiFieldDraft, insertApiTreeNode, jsonValueToBodyDraft,
} = require('./api-config');
const { createDefaultBootstrapDraft, createBootstrapPair } = require('./api-bootstrap');
const { createDefaultCursorDraft } = require('./api-cursor-pagination');
const { createDefaultLinkDraft } = require('./api-link-pagination');

const FIXTURE_DIR = path.join(__dirname, '..', '..', 'test-vectors', 'wire');
const UPDATE = process.env.UPDATE_WIRE_FIXTURES === '1';

// buildScrapingConfig takes ~37 positional parameters (the options-object refactor is Issue #387). The fixtures
// are the stable contract either way: this maps names to positions once, so a case reads as what it configures.
const PARAMETERS = [
  'url', 'mode', 'fields', 'groups', 'apiConfig', 'scriptFileName', 'outputFileName', 'engine', 'browserActions',
  'includePreview', 'useJsonOutput', 'additionalUrls', 'changeDetection', 'proxy', 'hardening', 'pagination',
  'persistentSession', 'includeOutputFile', 'externalConfig', 'combinedComponents', 'blocks', 'outputBlueprintId',
  'outputBlueprintFieldNames', 'outputBlueprintMapping', 'outputBlueprintSchemaKind', 'outputBlueprintTree',
  'outputBlueprintTreeMapping', 'discoveredUrls', 'preflight', 'requestDelay', 'retry', 'deduplication',
  'requestHeaders', 'respectRobotsDelay', 'skipVerification', 'robotsDisallow', 'appendOutput',
];

function request(state) {
  const defaults = {
    url: 'https://example.test/list', mode: 'flat', fields: [], groups: [], apiConfig: null, scriptFileName: null,
    outputFileName: null, engine: 'Static', browserActions: [], includePreview: false, useJsonOutput: false,
    additionalUrls: [], changeDetection: null, proxy: null, hardening: null, pagination: null, persistentSession: false,
    includeOutputFile: false, externalConfig: false, combinedComponents: null, blocks: null, outputBlueprintId: null,
    outputBlueprintFieldNames: [], outputBlueprintMapping: {}, outputBlueprintSchemaKind: 'Flat', outputBlueprintTree: [],
    outputBlueprintTreeMapping: {}, discoveredUrls: null, preflight: false, requestDelay: null, retry: null,
    deduplication: null, requestHeaders: null, respectRobotsDelay: false, skipVerification: false, robotsDisallow: null,
    appendOutput: false,
  };
  const merged = { ...defaults, ...state };
  const unknown = Object.keys(state).filter((key) => !PARAMETERS.includes(key));
  if (unknown.length) throw new Error(`unknown request parameter(s): ${unknown.join(', ')}`);
  return buildScrapingConfig(...PARAMETERS.map((name) => merged[name]));
}

// ── Building blocks shared by several cases ──────────────────────────────────

const FLAT_FIELDS = [
  { name: 'Title', selector: 'h2.title', attribute: null },
  { name: 'Price', selector: 'span.price', attribute: null },
  { name: 'Link', selector: 'a.more', attribute: 'href' },
];

function containerTree() {
  let groups = [];
  groups = insertContainerNode(groups, null, buildGroupNode('Category', 'section.category', true));
  groups = insertContainerNode(groups, [0], buildFieldNode('Heading', 'h2', 'text', null));
  groups = insertContainerNode(groups, [0], buildGroupNode('Dish', 'li.dish', true));
  groups = insertContainerNode(groups, [0, 1], buildFieldNode('Name', 'h3', 'text', null));
  groups = insertContainerNode(groups, [0, 1], buildFieldNode('Price', '.price', 'text', null, null, [{ kind: 'trim' }, { kind: 'toNumber' }]));
  groups = insertContainerNode(groups, [0, 1], buildFieldNode('Label', 'h3', 'ownText', null));
  groups = insertContainerNode(groups, [0, 1], buildFieldNode('Vegan', '.vegan', 'exists', null));
  groups = insertContainerNode(groups, [0, 1], buildFieldNode('Link', 'a', 'attribute', 'href'));
  return groups;
}

function apiTree() {
  let groups = [buildApiGroupDraft('Category', 'categories')];
  groups = insertApiTreeNode(groups, [0], buildApiFieldDraft('Name', 'name'));
  groups = insertApiTreeNode(groups, [0], buildApiGroupDraft('Product', 'products'));
  groups = insertApiTreeNode(groups, [0, 1], buildApiFieldDraft('Title', 'title', [{ kind: 'trim' }]));
  groups = insertApiTreeNode(groups, [0, 1], buildApiFieldDraft('Price', 'price', [{ kind: 'toCurrency', format: '1,234.56', onError: 'KeepOriginal', defaultValue: '' }]));
  return groups;
}

function apiDraft(overrides = {}) {
  return {
    urlParts: parseUrlTemplateParts('https://example.test/api/items'),
    itemsPath: 'items', fields: [{ name: 'Name', path: 'name' }, { name: 'Price', path: 'price' }],
    groups: null, parameterSources: {}, capturedHeaders: [], headerDecisions: {}, method: 'GET', bodyTree: null,
    ...overrides,
  };
}

function variableUrl(url, indexesOrKeys) {
  const parts = parseUrlTemplateParts(url);
  parts.pathSegments.forEach((segment, index) => {
    if (indexesOrKeys.includes(index)) { segment.variable = true; segment.name = segment.name || `p${index}`; }
  });
  parts.queryParams.forEach((param) => {
    if (indexesOrKeys.includes(param.key)) { param.variable = true; param.name = param.key; }
  });
  return parts;
}

const HARDENING_ALL = {
  noResult: { enabled: true, severity: 'Error' },
  nullRate: [{ fieldName: 'Price', threshold: 40, severity: 'Warning' }],
  baseline: { enabled: true, severity: 'Warning', dropThresholdPercent: 25 },
  blocking: { enabled: true, severity: 'Warning', minBodyLengthText: '1000', phrasesText: 'Access Denied\nPlease verify you are human' },
  requiredFields: { enabled: true, severity: 'Warning', fields: ['Title'] },
};

const CHANGE_DETECTION_EMAIL = {
  enabled: true, notify: 'Email',
  email: { smtpHostEnvVar: 'SMTP_HOST', smtpPortEnvVar: 'SMTP_PORT', smtpUsernameEnvVar: 'SMTP_USER', smtpPasswordEnvVar: 'SMTP_PASSWORD', fromEnvVar: 'MAIL_FROM', toEnvVar: 'MAIL_TO' },
  webhook: { urlEnvVar: '' },
};

const LOGIN_ACTIONS = (() => {
  let actions = [];
  for (const kind of ['waitFor', 'fill', 'fill', 'click', 'waitFor']) actions = addBrowserAction(actions, kind);
  actions = updateBrowserAction(actions, 0, { selector: 'form#login' });
  actions = updateBrowserAction(actions, 1, { selector: '#user', environmentVariableName: 'SITE_USERNAME' });
  actions = updateBrowserAction(actions, 2, { selector: '#password', environmentVariableName: 'SITE_PASSWORD' });
  actions = updateBrowserAction(actions, 3, { selector: 'button.login' });
  actions = updateBrowserAction(actions, 4, { selector: '.account', timeoutMs: 10000 });
  return actions;
})();

// ── The matrix ───────────────────────────────────────────────────────────────

const CASES = {
  'flat-basic': () => request({ fields: FLAT_FIELDS }),
  'flat-names-and-json-output': () => request({ fields: FLAT_FIELDS, scriptFileName: 'menu_scraper', outputFileName: 'menu_out', useJsonOutput: 'json', includePreview: true, includeOutputFile: true }),
  'flat-sqlite-output': () => request({ fields: FLAT_FIELDS, useJsonOutput: 'sqlite' }),
  'flat-xlsx-output': () => request({ fields: FLAT_FIELDS, useJsonOutput: 'xlsx' }),
  'flat-transforms': () => request({
    fields: [
      { name: 'Title', selector: 'h2.title', attribute: null, transforms: [{ kind: 'trim' }, { kind: 'replace', find: 'Sale: ', replacement: '' }] },
      { name: 'Price', selector: 'span.price', attribute: null, transforms: [{ kind: 'regexExtract', pattern: '([0-9,.]+)', group: 1 }, { kind: 'toNumber' }] },
      { name: 'Stock', selector: 'span.stock', attribute: null, transforms: [{ kind: 'toInteger', onError: 'UseDefault', defaultValue: '0' }] },
      { name: 'Available', selector: 'span.available', attribute: null, transforms: [{ kind: 'toBoolean', onError: 'KeepOriginal', defaultValue: '' }] },
      { name: 'Released', selector: 'time', attribute: null, transforms: [{ kind: 'toDate', sourceFormat: '{dd}.{mm}.{yyyy}', onError: 'UseDefault', defaultValue: '1970-01-01' }] },
      { name: 'Amount', selector: 'span.amount', attribute: null, transforms: [{ kind: 'toCurrency', format: '1.234,56', onError: 'KeepOriginal', defaultValue: '' }] },
    ],
  }),
  'flat-derived-fields': () => request({
    fields: [
      { name: 'First', selector: 'span.first', attribute: null, hiddenFromOutput: true },
      { name: 'Last', selector: 'span.last', attribute: null, hiddenFromOutput: true },
      { name: 'Full', selector: null, attribute: null, transforms: [{ kind: 'combineFields', sourceFieldNames: ['First', 'Last'], separator: ' ' }] },
      { name: 'Initial', selector: null, attribute: null, transforms: [{ kind: 'splitField', sourceFieldName: 'First', separator: '-', index: 0 }] },
    ],
  }),
  'flat-download': () => request({
    fields: [
      { name: 'Title', selector: 'h2.title', attribute: null },
      { name: 'Image', selector: 'img.product', attribute: 'src', download: true, maxDownloadSizeBytes: 5242880, allowedContentTypes: ['image/jpeg', 'image/png'] },
    ],
  }),
  'flat-text-filter-selector': () => request({ fields: [{ name: 'Next', selector: 'a.pager:contains("Next page")', attribute: 'href' }] }),
  'flat-static-settings': () => request({
    fields: FLAT_FIELDS,
    additionalUrls: ['https://example.test/list?page=2'],
    pagination: { enabled: true, kind: 'nextLink', nextLinkSelector: 'a.next', urlTemplate: '', maxPages: 5 },
    proxy: { enabled: true, envVar: 'PROXY_LIST' },
    requestDelay: { enabled: true, minSecondsText: '1', maxSecondsText: '3' },
    retry: { enabled: true, maxAttemptsText: '4', delaySecondsText: '1.5', exponential: true, statusCodesText: '429, 503' },
    respectRobotsDelay: true,
    robotsDisallow: { enabled: true, action: 'Skip' },
    appendOutput: true,
    preflight: true,
    externalConfig: true,
    skipVerification: true,
    requestHeaders: { enabled: true, rows: [{ name: 'Accept-Language', kind: 'value', value: 'de-CH' }, { name: 'Authorization', kind: 'env', value: 'API_TOKEN' }] },
    deduplication: { enabled: true, keyFields: ['Title', 'Price'], incremental: true, appendOutput: true, retentionKind: 'MaxAge', retentionValueText: '30' },
    hardening: HARDENING_ALL,
    changeDetection: CHANGE_DETECTION_EMAIL,
  }),
  'flat-page-number-pagination-and-discovery': () => request({
    fields: FLAT_FIELDS,
    pagination: { enabled: true, kind: 'pageNumber', nextLinkSelector: '', urlTemplate: '{url}?page={page}', maxPages: 8 },
    discoveredUrls: { enabled: true, pageUrl: 'https://example.test/categories', linkSelector: 'nav a', maxUrls: 25 },
  }),
  'flat-webhook-change-detection': () => request({
    fields: FLAT_FIELDS,
    changeDetection: { enabled: true, notify: 'Webhook', email: CHANGE_DETECTION_EMAIL.email, webhook: { urlEnvVar: 'WEBHOOK_URL' } },
  }),
  'flat-browser-login-flow': () => request({
    fields: FLAT_FIELDS, engine: 'Browser', browserActions: LOGIN_ACTIONS, persistentSession: true,
  }),
  'flat-browser-scroll-click-frame': () => {
    let actions = [];
    for (const kind of ['scroll', 'click', 'click', 'waitFor']) actions = addBrowserAction(actions, kind);
    actions = updateBrowserAction(actions, 0, { containerSelector: 'div.feed', loadMoreButtonSelector: 'button.more', maxIterations: 6, waitAfterMs: 700, scrollStepPx: 400 });
    actions = updateBrowserAction(actions, 1, { selector: 'button.cookies' });
    actions = updateBrowserAction(actions, 2, { selector: 'a.toggle', target: 'all', waitAfterMs: 300, framePath: ['iframe#cmp'] });
    actions = updateBrowserAction(actions, 3, { selector: '#consent', framePath: ['iframe#cmp'] });
    return request({
      fields: [...FLAT_FIELDS, { name: 'Stock', selector: 'span.stock', attribute: null, framePath: ['iframe#shop'] }],
      engine: 'Browser', browserActions: actions,
    });
  },
  'flat-output-blueprint': () => request({
    fields: FLAT_FIELDS, outputBlueprintId: '1', outputBlueprintSchemaKind: 'Flat',
    outputBlueprintFieldNames: ['product', 'price_eur'], outputBlueprintMapping: { product: 'Title', price_eur: 'Price' },
  }),

  'container-basic': () => request({ mode: 'container', url: 'https://example.test/menu', groups: containerTree() }),
  'container-json-output-and-settings': () => request({
    mode: 'container', url: 'https://example.test/menu', groups: containerTree(), useJsonOutput: 'json',
    requestHeaders: { enabled: true, rows: [{ name: 'Referer', kind: 'value', value: 'https://example.test/' }] },
    deduplication: { enabled: true, keyFields: ['Name'], incremental: true, appendOutput: false, retentionKind: 'MaxCount', retentionValueText: '5000' },
    hardening: { ...HARDENING_ALL, requiredFields: { enabled: true, severity: 'Error', fields: ['Name'] }, nullRate: [{ fieldName: 'Price', threshold: 50, severity: 'Warning' }] },
    pagination: { enabled: true, kind: 'nextLink', nextLinkSelector: 'a.next', urlTemplate: '', maxPages: 4 },
  }),
  'container-download': () => {
    let groups = insertContainerNode([], null, buildGroupNode('Item', 'li.item', true));
    groups = insertContainerNode(groups, [0], buildFieldNode('Title', 'h3', 'text', null));
    groups = insertContainerNode(groups, [0], buildFieldNode('Image', 'img', 'attribute', 'src', null, [], true, 2097152, ['image/jpeg']));
    return request({ mode: 'container', groups });
  },
  'container-derived-fields': () => {
    let groups = insertContainerNode([], null, buildGroupNode('Dish', 'li.dish', true));
    groups = insertContainerNode(groups, [0], { ...buildFieldNode('First', '.first', 'text', null), hiddenFromOutput: true });
    groups = insertContainerNode(groups, [0], buildFieldNode('Price', '.price', 'text', null));
    groups = insertContainerNode(groups, [0], buildFieldNode('Combined', null, 'text', null, null, [{ kind: 'combineFields', sourceFieldNames: ['First', 'Price'], separator: ': ' }]));
    return request({ mode: 'container', groups });
  },
  'container-browser-frame': () => {
    let groups = insertContainerNode([], null, buildGroupNode('Widget', 'div.widget', true, ['iframe#shop']));
    groups = insertContainerNode(groups, [0], buildFieldNode('Name', 'h4', 'text', null, ['iframe#shop']));
    return request({ mode: 'container', groups, engine: 'Browser' });
  },
  'container-blueprint-flat': () => request({
    mode: 'container', url: 'https://example.test/menu', groups: containerTree(), outputBlueprintId: '2', outputBlueprintSchemaKind: 'Flat',
    outputBlueprintFieldNames: ['category', 'dish', 'price'], outputBlueprintMapping: { category: 'Heading', dish: 'Name', price: 'Price' },
  }),
  'container-blueprint-tree': () => request({
    mode: 'container', url: 'https://example.test/menu', groups: containerTree(), outputBlueprintId: '3', outputBlueprintSchemaKind: 'Tree',
    outputBlueprintTree: [{ kind: 'group', name: 'Menu', children: [{ kind: 'field', name: 'title' }, { kind: 'group', name: 'Entry', children: [{ kind: 'field', name: 'label' }, { kind: 'field', name: 'amount' }] }] }],
    outputBlueprintTreeMapping: { '0.0': 'Heading', '0.1.0': 'Name', '0.1.1': 'Price' },
  }),

  'api-flat': () => request({ mode: 'api', url: 'https://example.test/api/items', apiConfig: buildApiConfig(apiDraft()) }),
  'api-flat-sources': () => request({
    mode: 'api',
    apiConfig: buildApiConfig(apiDraft({
      urlParts: variableUrl('https://example.test/api/cat/week/page/day/items', [2, 3, 4, 5]),
      parameterSources: {
        p2: buildDiscoverySource('https://example.test/api/categories', 'categories', 'slug'),
        p3: buildRangeSource('IsoWeek', '2026-W01', '2026-W03'),
        p4: buildRangeSource('Number', '1', '3'),
        p5: buildRangeSource('Date', '20260101', '20260103', '{yyyy}{mm}{dd}'),
      },
    })),
  }),
  'api-flat-static-list-and-browser-discovery': () => request({
    mode: 'api',
    apiConfig: buildApiConfig(apiDraft({
      urlParts: variableUrl('https://example.test/api/shop/books?lang=de', [2, 'lang']),
      parameterSources: {
        p2: buildBrowserDiscoverySource('https://example.test/shop', [{ kind: 'click', selector: 'button.menu' }, { kind: 'waitFor', selector: 'nav.menu a', timeoutMs: 5000 }]),
        lang: buildStaticListSource(['de', 'en']),
      },
    })),
  }),
  'api-tree': () => request({ mode: 'api', apiConfig: buildApiConfig(apiDraft({ itemsPath: undefined, fields: undefined, groups: apiTree() })) }),
  'api-tree-json-output-with-settings': () => request({
    mode: 'api', useJsonOutput: 'json', apiConfig: buildApiConfig(apiDraft({ itemsPath: undefined, fields: undefined, groups: apiTree() })),
    hardening: { noResult: { enabled: true, severity: 'Warning' }, requiredFields: { enabled: true, severity: 'Error', fields: ['Title'] } },
    retry: { enabled: true, maxAttemptsText: '3', delaySecondsText: '2', exponential: true, statusCodesText: '' },
    requestDelay: { enabled: true, minSecondsText: '0.5', maxSecondsText: '' },
    outputBlueprintId: null,
  }),
  'api-post-body-with-variable': () => {
    const bodyTree = jsonValueToBodyDraft({ query: '{ items { name } }', variables: { week: 1, limit: 50, active: true, cursor: null, tags: ['a', 'b'] } });
    bodyTree.properties.variables.properties.week = { kind: 'variable', parameterId: 'body:week', coerceTo: 'Number' };
    return request({
      mode: 'api',
      apiConfig: buildApiConfig(apiDraft({
        urlParts: parseUrlTemplateParts('https://example.test/api/search'), method: 'POST', bodyTree,
        bodyParameterNames: ['week'], parameterIdToName: { 'body:week': 'week' },
        parameterSources: { week: buildRangeSource('Number', '1', '2') },
      })),
    });
  },
  'api-headers-and-bootstrap': () => {
    const bootstrap = {
      ...createDefaultBootstrapDraft(), name: 'token', url: 'https://example.test/auth/token', valuePath: 'access_token', bodyEncoding: 'Form',
      bodyFields: [{ ...createBootstrapPair('literal'), name: 'client_id', value: 'abc' }, { ...createBootstrapPair('env'), name: 'client_secret', envName: 'CLIENT_SECRET' }],
    };
    return request({
      mode: 'api',
      apiConfig: buildApiConfig(apiDraft({
        capturedHeaders: [{ name: 'Accept', value: 'application/json' }, { name: 'X-Api-Key', value: 'k' }, { name: 'Authorization', value: 'Bearer abc' }],
        headerDecisions: {
          Accept: { include: true, mode: 'literal' },
          'X-Api-Key': { include: true, mode: 'env', envName: 'API_KEY' },
          Authorization: { include: true, mode: 'bootstrap', template: 'Bearer {token}' },
        },
        bootstrap,
      })),
    });
  },
  'api-cursor-pagination-query': () => request({
    mode: 'api',
    apiConfig: buildApiConfig(apiDraft({ cursorPagination: { ...createDefaultCursorDraft(), nextCursorPath: 'meta.next', hasNextPagePath: 'meta.more', target: 'Query', queryParameterName: 'cursor', maxPages: 10 } })),
  }),
  'api-cursor-pagination-body': () => {
    const bodyTree = jsonValueToBodyDraft({ cursor: null, size: 20 });
    return request({
      mode: 'api',
      apiConfig: buildApiConfig(apiDraft({
        urlParts: parseUrlTemplateParts('https://example.test/api/items'), method: 'POST', bodyTree,
        cursorPagination: { ...createDefaultCursorDraft(), nextCursorPath: 'meta.next', target: 'Body', bodyPath: 'cursor', maxPages: 7 },
      })),
    });
  },
  'api-link-header-pagination': () => request({ mode: 'api', apiConfig: buildApiConfig(apiDraft({ linkHeaderPagination: { ...createDefaultLinkDraft(), maxPages: 12 } })) }),
  'api-embedded-json': () => request({
    mode: 'api', url: 'https://example.test/page',
    apiConfig: buildApiConfig(apiDraft({ urlParts: parseUrlTemplateParts('https://example.test/page'), embeddedJsonSource: { scriptSelector: 'script#__NEXT_DATA__' } })),
  }),
  'api-flat-output-blueprint': () => request({
    mode: 'api', apiConfig: buildApiConfig(apiDraft()), outputBlueprintId: '4', outputBlueprintSchemaKind: 'Flat',
    outputBlueprintFieldNames: ['product', 'price_eur'], outputBlueprintMapping: { product: 'Name', price_eur: 'Price' },
  }),

  'blocks-basic': () => request({
    mode: 'blocks', url: 'https://example.test/offers',
    blocks: [
      { name: 'Deals', outputFileName: 'deals', shape: 'flat', fields: [{ name: 'Title', selector: 'div.deal h3', attribute: null }, { name: 'Price', selector: 'div.deal .price', attribute: null, transforms: [{ kind: 'toNumber' }] }] },
      { name: 'Vouchers', outputFileName: 'vouchers', shape: 'group', groups: (() => {
        let groups = insertContainerNode([], null, buildGroupNode('Voucher', 'div.voucher', true));
        return insertContainerNode(groups, [0], buildFieldNode('Code', '.code', 'text', null));
      })() },
    ],
  }),
  'blocks-browser-shared-navigation': () => request({
    mode: 'blocks', url: 'https://example.test/offers', engine: 'Browser', browserActions: LOGIN_ACTIONS, persistentSession: true,
    additionalUrls: ['https://example.test/offers?page=2'], proxy: { enabled: true, envVar: 'PROXY_LIST' },
    pagination: { enabled: true, kind: 'nextLink', nextLinkSelector: 'a.next', urlTemplate: '', maxPages: 3 },
    blocks: [
      { name: 'Deals', outputFileName: '', shape: 'flat', fields: [{ name: 'Title', selector: 'div.deal h3', attribute: null }] },
      { name: 'Tickets', outputFileName: '', shape: 'flat', fields: [{ name: 'Name', selector: '.ticket', attribute: null }] },
    ],
  }),

  'combined-static-and-api': () => request({
    mode: 'combined', url: 'https://example.test', scriptFileName: 'everything', outputFileName: 'all_data',
    combinedComponents: [
      { name: 'products', savedConfigId: 1, config: request({ url: 'https://example.test/products', fields: FLAT_FIELDS }) },
      { name: 'api_items', savedConfigId: 2, config: request({ mode: 'api', url: 'https://example.test/api', apiConfig: buildApiConfig(apiDraft()) }) },
    ],
  }),
};

function fixturePath(id) {
  return path.join(FIXTURE_DIR, `${id}.json`);
}

function render(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

describe('wire-format fixtures (test-vectors/wire)', () => {
  test.each(Object.keys(CASES))('%s', (id) => {
    const actual = render(CASES[id]());
    if (UPDATE) {
      fs.mkdirSync(FIXTURE_DIR, { recursive: true });
      fs.writeFileSync(fixturePath(id), actual);
      return;
    }
    if (!fs.existsSync(fixturePath(id))) {
      throw new Error(`test-vectors/wire/${id}.json does not exist yet. Create it with UPDATE_WIRE_FIXTURES=1 npx jest popup/wire-fixtures and review it.`);
    }
    expect(actual).toBe(fs.readFileSync(fixturePath(id), 'utf8'));
  });

  test('there are no fixture files without a case', () => {
    const known = new Set(Object.keys(CASES).map((id) => `${id}.json`));
    const orphans = (fs.existsSync(FIXTURE_DIR) ? fs.readdirSync(FIXTURE_DIR) : []).filter((file) => file.endsWith('.json') && !known.has(file));
    if (UPDATE) {
      orphans.forEach((file) => fs.unlinkSync(path.join(FIXTURE_DIR, file)));
      return;
    }
    expect(orphans).toEqual([]);
  });
});
