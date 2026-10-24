require('./test-support/popup-env');
const {
  STATES,
  renderApiConfigScreen,
  renderBodyTree,
} = require('./popup');

describe('renderApiConfigScreen (Issue #53 Phase 5)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <ul id="api-tree-root"></ul>
      <ul id="api-config-segments"></ul>
      <ul id="api-config-query-params"></ul>
      <div id="api-config-parameters"></div>
      <ul id="api-config-headers"></ul>
      <button id="btn-api-config-confirm" disabled></button>
    `;
  });

  const baseDraft = () => ({
    sourceUrl: 'https://example.com/api/items/42?category=Elektronik',
    urlParts: {
      origin: 'https://example.com',
      pathSegments: [
        { value: 'api', variable: false, name: '' },
        { value: 'items', variable: false, name: '' },
        { value: '42', variable: false, name: '' },
      ],
      queryParams: [{ key: 'category', value: 'Elektronik', variable: false, name: 'category' }],
    },
    groups: [{ kind: 'group', name: 'items', path: 'data.items', children: [{ kind: 'field', name: 'Titel', path: 'name' }] }],
    capturedHeaders: [{ name: 'Authorization', value: 'Bearer secret' }],
    parameterSources: {},
    headerDecisions: {},
  });

  test('renders the confirmed tree with editable names and read-only paths', () => {
    renderApiConfigScreen(baseDraft(), null);
    const fieldRow = document.querySelector('[data-path="[0,0]"] > .api-tree-row');
    expect(fieldRow.querySelector('.api-tree-name').value).toBe('Titel');
    expect(fieldRow.querySelector('.api-tree-path').textContent).toBe('name');
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

  test('"Übernehmen" is already enabled with no variable parts at all (a fully static endpoint is valid)', () => {
    const draft = baseDraft();
    renderApiConfigScreen(draft, null);
    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(false);
  });

  test('enables "Übernehmen" only once a declared variable part has a name and a source kind', () => {
    const draft = baseDraft();
    draft.urlParts.pathSegments[2].variable = true;
    draft.urlParts.pathSegments[2].name = 'id';
    renderApiConfigScreen(draft, null); // variable part declared, but no source kind chosen yet
    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(true);

    draft.parameterSources['path:2'] = { kind: 'staticList', valuesText: '42' };
    renderApiConfigScreen(draft, null);
    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(false);
  });
});

describe('renderBodyTree (Issue #55, Phase B4)', () => {
  beforeEach(() => {
    document.body.innerHTML = `<ul id="body-tree-root"></ul>`;
  });

  const draft = () => ({
    urlParts: { origin: 'https://example.com', pathSegments: [], queryParams: [] },
    bodyParameters: [{ id: 'body:0', name: 'category' }],
    bodyTree: {
      kind: 'object',
      properties: {
        query: { kind: 'literal', literalKind: 'String', value: 'fixed query' },
        variables: {
          kind: 'object',
          properties: { category: { kind: 'variable', literalKind: 'String', value: 'electronics', parameterId: 'body:0', coerceTo: null } },
        },
      },
    },
  });

  test('renders nothing when there is no body tree at all', () => {
    renderBodyTree({ urlParts: { origin: 'x', pathSegments: [], queryParams: [] }, bodyTree: null });
    expect(document.querySelectorAll('.body-tree-node')).toHaveLength(0);
  });

  test('a literal leaf shows its value preview and a "to variable" button, no picker', () => {
    renderBodyTree(draft());
    const nodes = document.querySelectorAll('.body-tree-node');
    const queryNode = Array.from(nodes).find(li => li.querySelector('.body-tree-label').textContent.startsWith('query:'));
    expect(queryNode.querySelector('.body-tree-label').textContent).toBe('query: "fixed query"');
    expect(queryNode.querySelector('.btn-body-to-variable')).not.toBeNull();
    expect(queryNode.querySelector('.body-tree-parameter-picker')).toBeNull();
  });

  test('a variable leaf shows the bound parameter selected in the picker, a coerceTo select, and a "to fixed" button', () => {
    renderBodyTree(draft());
    const nodes = document.querySelectorAll('.body-tree-node');
    const categoryNode = Array.from(nodes).find(li => li.querySelector('.body-tree-label').textContent === 'category');
    const picker = categoryNode.querySelector('.body-tree-parameter-picker');
    expect(picker.value).toBe('body:0');
    expect(categoryNode.querySelector('.body-tree-coerce-to').value).toBe('String');
    expect(categoryNode.querySelector('.btn-body-to-fixed')).not.toBeNull();
    expect(categoryNode.querySelector('.btn-body-to-variable')).toBeNull();
  });

  test('an object node has no leaf controls of its own and recurses into its children', () => {
    renderBodyTree(draft());
    const nodes = document.querySelectorAll('.body-tree-node');
    const variablesNode = Array.from(nodes).find(li => li.querySelector('.body-tree-label').textContent === 'variables');
    expect(variablesNode.querySelector(':scope > .body-tree-row .btn-body-to-variable')).toBeNull();
    expect(variablesNode.querySelectorAll('.body-tree-children > .body-tree-node')).toHaveLength(1);
  });
});

// ── STATES export ─────────────────────────────────────────────────────────────

test('STATES contains expected keys', () => {
  const expected = ['CHECKING_COMPANION', 'COMPANION_ERROR', 'IDLE', 'SELECTING', 'API_CONFIG', 'GENERATING', 'DONE'];
  expected.forEach(key => expect(STATES).toHaveProperty(key));
});
