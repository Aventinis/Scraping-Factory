// Issue #226: custom request headers for flat/container/Blocks mode — pure
// draft/wire logic (request-headers.ts), the builder integration
// (buildScrapingConfig), the reverse mapping for a loaded config
// (applyConfigToState), the one-time test values, and the settings UI in the
// real popup.
const {
  createDefaultRequestHeaders, addHeaderRow, removeHeaderRow, updateHeaderRow,
  buildRequestHeadersConfig, applyRequestHeadersConfig, buildHeaderVerificationValues,
} = require('./request-headers');
const { buildScrapingConfig } = require('./scraping-config-builder');
const { applyConfigToState } = require('./config-import');

const row = (name, value, kind = 'value') => ({ name, kind, value });
const draft = (rows, enabled = true) => ({ enabled, rows });

describe('draft helpers', () => {
  test('defaults are off with no rows', () => {
    expect(createDefaultRequestHeaders()).toEqual({ enabled: false, rows: [] });
  });

  test('add, update and remove a row', () => {
    let d = addHeaderRow(createDefaultRequestHeaders());
    expect(d.rows).toEqual([{ name: '', kind: 'value', value: '' }]);
    d = updateHeaderRow(d, 0, { name: 'X-A', value: 'v' });
    d = addHeaderRow(d);
    expect(d.rows).toHaveLength(2);
    d = removeHeaderRow(d, 0);
    expect(d.rows).toEqual([{ name: '', kind: 'value', value: '' }]);
  });
});

describe('buildRequestHeadersConfig', () => {
  test('literal and environment-variable rows map to the ApiHeader wire shape', () => {
    expect(buildRequestHeadersConfig(draft([row('Accept-Language', 'de-CH'), row('X-Api-Key', 'API_KEY', 'env')]))).toEqual([
      { name: 'Accept-Language', value: 'de-CH' },
      { name: 'X-Api-Key', environmentVariableName: 'API_KEY' },
    ]);
  });

  test('names and values are trimmed', () => {
    expect(buildRequestHeadersConfig(draft([row('  X-A ', ' v ')]))).toEqual([{ name: 'X-A', value: 'v' }]);
  });

  test('incomplete rows are skipped', () => {
    expect(buildRequestHeadersConfig(draft([row('', 'v'), row('X-A', ''), row('X-B', 'ok')]))).toEqual([{ name: 'X-B', value: 'ok' }]);
  });

  test.each([
    [draft([row('X-A', 'v')], false)],
    [draft([])],
    [draft([row('', '')])],
    [null],
    [undefined],
  ])('%j is treated as off', (input) => {
    expect(buildRequestHeadersConfig(input)).toBeNull();
  });

  test('duplicate names are passed through for the companion to reject by name', () => {
    expect(buildRequestHeadersConfig(draft([row('X-A', '1'), row('x-a', '2')]))).toHaveLength(2);
  });
});

describe('buildScrapingConfig', () => {
  const fields = [{ name: 'Titel', selector: 'h1' }];
  const headers = draft([row('X-A', 'v')]);
  // Same positional layout the other builder tests use, plus the two new
  // trailing parameters (deduplication, requestHeaders).
  const build = (mode, requestHeaders, extra = {}) => buildScrapingConfig({
    url: 'https://example.com',
    mode,
    fields: extra.fields ?? fields,
    groups: extra.groups ?? [],
    apiConfig: extra.apiConfig ?? null,
    combinedComponents: extra.combinedComponents ?? null,
    blocks: extra.blocks ?? null,
    requestHeaders,
  });

  test('flat mode sends headers only when configured', () => {
    expect(build('flat', headers).headers).toEqual([{ name: 'X-A', value: 'v' }]);
    expect(build('flat', draft([row('X-A', 'v')], false))).not.toHaveProperty('headers');
    expect(build('flat', undefined)).not.toHaveProperty('headers');
  });

  test('container and Blocks mode send them too', () => {
    const groups = [{ kind: 'group', name: 'G', selector: '.g', repeating: true, children: [{ kind: 'field', name: 'N', selector: 'h1', mode: 'text' }] }];
    expect(build('container', headers, { groups }).headers).toEqual([{ name: 'X-A', value: 'v' }]);
    const blocks = [{ name: 'a', shape: 'flat', fields }, { name: 'b', shape: 'flat', fields }];
    expect(build('blocks', headers, { blocks }).headers).toEqual([{ name: 'X-A', value: 'v' }]);
  });

  test('API and Combined mode never send them', () => {
    const apiConfig = { urlTemplate: 'https://example.com/a', itemsPath: 'items', fields: [{ name: 'Id', path: 'id' }] };
    expect(build('api', headers, { apiConfig })).not.toHaveProperty('headers');
    expect(build('combined', headers, { combinedComponents: [] })).not.toHaveProperty('headers');
  });
});

describe('loading a config restores the request headers', () => {
  const base = { url: 'https://example.com', fields: [{ name: 'Titel', selector: 'h1' }], outputFormat: 'Csv' };

  test('round-trips literal and environment-variable headers', () => {
    const wire = [{ name: 'Accept-Language', value: 'de-CH' }, { name: 'X-Api-Key', environmentVariableName: 'API_KEY' }];
    const state = applyConfigToState({ ...base, headers: wire }).requestHeaders;
    expect(state).toEqual({
      enabled: true,
      rows: [{ name: 'Accept-Language', kind: 'value', value: 'de-CH' }, { name: 'X-Api-Key', kind: 'env', value: 'API_KEY' }],
    });
    expect(buildRequestHeadersConfig(state)).toEqual(wire);
  });

  test('no headers means off with no rows', () => {
    expect(applyConfigToState(base).requestHeaders).toEqual(createDefaultRequestHeaders());
    expect(applyRequestHeadersConfig([])).toEqual(createDefaultRequestHeaders());
  });

  test('an API config never restores headers into the DOM-mode state', () => {
    const api = { url: 'https://example.com', api: { urlTemplate: 'https://example.com/a', itemsPath: 'items', fields: [{ name: 'Id', path: 'id' }], headers: [{ name: 'X', value: 'y' }] } };
    expect(applyConfigToState(api).requestHeaders).toEqual(createDefaultRequestHeaders());
  });
});

describe('buildHeaderVerificationValues', () => {
  test('only env-var rows with a typed test value are included, keyed by the variable name', () => {
    const state = draft([row('X-Api-Key', 'API_KEY', 'env'), row('X-Other', 'OTHER_KEY', 'env'), row('Accept-Language', 'de-CH')]);
    expect(buildHeaderVerificationValues(state, { API_KEY: 'k', LANGUAGE: 'unrelated' })).toEqual({ API_KEY: 'k' });
  });

  test('nothing for a disabled draft or no test values', () => {
    expect(buildHeaderVerificationValues(draft([row('X', 'V', 'env')], false), { V: 'x' })).toEqual({});
    expect(buildHeaderVerificationValues(draft([row('X', 'V', 'env')]), null)).toEqual({});
    expect(buildHeaderVerificationValues(null, { V: 'x' })).toEqual({});
  });
});

describe('Request headers settings in the real popup', () => {
  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const mount = async (stored = {}) => {
    jest.resetModules();
    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div id="flat-mode-section"><div id="fields-list"></div><button id="btn-add-field"></button></div>
        <div id="request-headers-section">
          <input type="checkbox" id="toggle-request-headers" />
          <div id="request-headers-config" class="hidden">
            <div id="request-headers-list"></div>
            <select id="select-add-request-header"></select>
          </div>
        </div>
        <button id="btn-generate" disabled></button>
      </section>
    `;
    global.chrome = {
      runtime: { onMessage: { addListener: () => {} }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: { get: jest.fn().mockResolvedValue(stored), set: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flushMicrotasks();
  };

  const lastPersisted = () => chrome.storage.session.set.mock.calls.at(-1)[0].requestHeaders;
  const rows = () => [...document.querySelectorAll('#request-headers-list .request-header-row')];
  const commit = (el, patch) => {
    Object.assign(el, patch);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  beforeEach(async () => { await mount({ mode: 'flat', fields: [{ name: 'Titel', selector: 'h1' }] }); });

  // Issue #402: a header is chosen from the picker instead of starting from an
  // empty free-text row.
  const pick = (id) => commit(document.getElementById('select-add-request-header'), { value: id });

  test('is off by default; enabling it reveals the config and the picker, with no row yet', () => {
    expect(document.getElementById('request-headers-config').classList.contains('hidden')).toBe(true);
    commit(document.getElementById('toggle-request-headers'), { checked: true });

    expect(document.getElementById('request-headers-config').classList.contains('hidden')).toBe(false);
    expect(rows()).toHaveLength(0);
    expect(document.getElementById('select-add-request-header').options.length).toBeGreaterThan(2);
  });

  test('typing a name and a value is persisted with the scrape configuration', () => {
    commit(document.getElementById('toggle-request-headers'), { checked: true });
    pick('other');
    commit(rows()[0].querySelector('.request-header-name'), { value: 'Accept-Language' });
    commit(rows()[0].querySelector('.request-header-value'), { value: 'de-CH' });

    expect(lastPersisted()).toEqual({ enabled: true, rows: [{ name: 'Accept-Language', kind: 'value', value: 'de-CH' }] });
  });

  test('switching a row to an environment variable clears its value and shows the test-value box once a name is set', () => {
    commit(document.getElementById('toggle-request-headers'), { checked: true });
    pick('other');
    commit(rows()[0].querySelector('.request-header-name'), { value: 'X-Api-Key' });
    commit(rows()[0].querySelector('.request-header-kind'), { value: 'env' });
    expect(rows()[0].querySelector('.request-header-test-value')).toBeNull(); // no variable named yet

    commit(rows()[0].querySelector('.request-header-value'), { value: 'API_KEY' });
    expect(lastPersisted().rows[0]).toEqual({ name: 'X-Api-Key', kind: 'env', value: 'API_KEY' });
    expect(rows()[0].querySelector('.request-header-test-value')).not.toBeNull();
  });

  test('a typed test value is kept in memory only — never in the persisted state', () => {
    commit(document.getElementById('toggle-request-headers'), { checked: true });
    pick('other');
    commit(rows()[0].querySelector('.request-header-name'), { value: 'X-Api-Key' });
    commit(rows()[0].querySelector('.request-header-kind'), { value: 'env' });
    commit(rows()[0].querySelector('.request-header-value'), { value: 'API_KEY' });

    const testInput = rows()[0].querySelector('.request-header-test-value');
    testInput.value = 'super-secret';
    testInput.dispatchEvent(new Event('input', { bubbles: true }));

    const persisted = chrome.storage.session.set.mock.calls.map((call) => JSON.stringify(call[0])).join('\n');
    expect(persisted).not.toContain('super-secret');
    // typing must not rebuild the row (which would drop the cursor)
    expect(rows()[0].querySelector('.request-header-test-value')).toBe(testInput);
    expect(testInput.value).toBe('super-secret');
  });

  // Real regression found by the real-browser check: committing the name as
  // focus moves on (name → Tab → value) re-rendered the list and replaced the
  // value input the user had just moved into.
  test('committing a name keeps the neighbouring inputs in the DOM', () => {
    commit(document.getElementById('toggle-request-headers'), { checked: true });
    pick('other');
    const valueInput = rows()[0].querySelector('.request-header-value');

    commit(rows()[0].querySelector('.request-header-name'), { value: 'Accept-Language' });

    expect(rows()[0].querySelector('.request-header-value')).toBe(valueInput);
  });

  test('"Other" appends an empty row and "Remove" deletes one', () => {
    commit(document.getElementById('toggle-request-headers'), { checked: true });
    pick('other');
    pick('other');
    expect(rows()).toHaveLength(2);

    rows()[0].querySelector('.btn-remove-request-header').click();
    expect(rows()).toHaveLength(1);
  });

  test('the section is hidden for API and Combined mode, visible for flat, container and Blocks', async () => {
    for (const [mode, hidden] of [['api', true], ['combined', true], ['flat', false], ['container', false], ['blocks', false]]) {
      await mount({ mode });
      expect(document.getElementById('request-headers-section').classList.contains('hidden')).toBe(hidden);
    }
  });

  test('a stored configuration is restored when the popup reopens', async () => {
    await mount({ mode: 'flat', requestHeaders: { enabled: true, rows: [{ name: 'X-A', kind: 'value', value: 'v' }] } });

    expect(document.getElementById('toggle-request-headers').checked).toBe(true);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector('.request-header-name').value).toBe('X-A');
  });
});

describe('Request headers in the /generate request', () => {
  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const generateBody = async (stored) => {
    jest.resetModules();
    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div id="flat-mode-section"><div id="fields-list"></div><button id="btn-add-field"></button></div>
        <button id="btn-generate"></button>
      </section>
    `;
    global.chrome = {
      runtime: { onMessage: { addListener: () => {} }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: { get: jest.fn().mockResolvedValue(stored), set: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flushMicrotasks();
    document.getElementById('btn-generate').disabled = false;
    document.getElementById('btn-generate').click();
    await flushMicrotasks();
    const [, options] = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/generate'));
    return JSON.parse(options.body);
  };

  const stored = (requestHeaders) => ({ mode: 'flat', fields: [{ name: 'Titel', selector: 'h1' }], requestHeaders });

  test('the configured headers are sent as `headers`', async () => {
    const body = await generateBody(stored({ enabled: true, rows: [{ name: 'Accept-Language', kind: 'value', value: 'de-CH' }, { name: 'X-Api-Key', kind: 'env', value: 'API_KEY' }] }));

    expect(body.headers).toEqual([{ name: 'Accept-Language', value: 'de-CH' }, { name: 'X-Api-Key', environmentVariableName: 'API_KEY' }]);
    expect(body.verificationValues).toBeUndefined(); // no test value typed
  });

  test('no headers configured sends neither `headers` nor test values', async () => {
    const body = await generateBody(stored({ enabled: false, rows: [{ name: 'X-A', kind: 'value', value: 'v' }] }));

    expect(body).not.toHaveProperty('headers');
    expect(body).not.toHaveProperty('verificationValues');
  });
});
